import extend from 'extend';
import { resolveLineBreakAlgorithm } from './line-break-resolver';
import baselineHeuristic from './baseline-heuristic';
import {
  DEFAULT_LINE_HEIGHT,
  ELLIPSIS_CHAR
} from './text-const';

function memoize(func, opts = {}) {
  const {
    size = 5000,
    multipleArguments = false,
    toKey = arg => arg
  } = opts;
  let cache = Object.create(null);
  let index = Object.create(null);
  let counter = 0;
  let fifo = 0; // First-In-First-Out index
  let cacher;
  let k;

  if (multipleArguments) {
    cacher = (...args) => {
      k = toKey(...args);
      if (cacher.has(k)) {
        return cacher.get(k);
      }
      return cacher.set(k, func(...args));
    };
  } else {
    cacher = (arg) => {
      k = toKey(arg);
      if (cacher.has(k)) {
        return cacher.get(k);
      }
      return cacher.set(k, func(arg));
    };
  }

  cacher.set = (key, val) => {
    if (counter >= size) {
      delete cache[index[fifo]];
      delete index[fifo];
      counter--;
      fifo++;
    }
    cache[key] = val;
    index[counter] = key;
    counter++;
    return val;
  };

  cacher.get = key => cache[key];

  cacher.has = key => key in cache;

  cacher.clear = () => {
    cache = Object.create(null);
    index = Object.create(null);
    counter = 0;
    fifo = 0;
  };

  cacher.size = () => counter;

  return cacher;
}

let canvasCache;

const measureTextWidth = memoize((text, fontSize, fontFamily) => {
  canvasCache = canvasCache || document.createElement('canvas');
  const g = canvasCache.getContext('2d');
  g.font = `${fontSize} ${fontFamily}`;
  const w = g.measureText(text).width;
  return w;
}, { toKey: (...args) => JSON.stringify(args), multipleArguments: true });

/**
 * @private
 * @param {object} opts
 * @param {string} opts.text - Text to measure
 * @param {string} opts.fontSize - Font size with a unit definition, ex. 'px' or 'em'
 * @param {string} opts.fontFamily - Font family
 * @return {object} Width and height of text in pixels
 * @example
 * measureText({
 *  text: 'my text',
 *  fontSize: '12px',
 *  fontFamily: 'Arial'
 * }); // returns { width: 20, height: 12 }
 */
export const measureText = memoize((opts) => { // eslint-disable-line import/prefer-default-export
  // if (opts.text.length > 'somelength') // do not measure each char
  const chars = Array.from(opts.text); // https://stackoverflow.com/a/38901550
  let width = 0;
  for (let i = 0, len = chars.length; i < len; i++) {
    width += measureTextWidth(chars[i], opts.fontSize, opts.fontFamily);
  }
  const height = measureTextWidth('M', opts.fontSize, opts.fontFamily) * 1.2;
  return { width, height };
}, { toKey: opts => `${opts.text}${opts.fontSize}${opts.fontFamily}` });

/**
 * Calculates the bounding rectangle of a text node.
 * The bounding rectangle is a approximate of the "em square" seen here (http://www.w3resource.com/html5-canvas/html5-canvas-text.php)
 * @ignore
 * @param {object} attrs - Text node definition
 * @param {number} [attrs.x] - X-coordinate
 * @param {number} [attrs.y] - Y-coordinate
 * @param {number} [attrs.dx] - Delta x-coordinate
 * @param {number} [attrs.dy] - Delta y-coordinate
 * @param {string} [attrs.anchor] - Text anchor
 * @param {number} [attrs.maxWidth] - Maximum allowed text width
 * @return {object} The bounding rectangle
 */
function calcTextBounds(attrs, measureFn = measureText) {
  const fontSize = attrs['font-size'] || attrs.fontSize;
  const fontFamily = attrs['font-family'] || attrs.fontFamily;
  const textMeasure = measureFn({ text: attrs.text, fontFamily, fontSize });
  const calWidth = Math.min(attrs.maxWidth || textMeasure.width, textMeasure.width); // Use actual value if max is not set
  const x = attrs.x || 0;
  const y = attrs.y || 0;
  const dx = attrs.dx || 0;
  const dy = (attrs.dy || 0) + baselineHeuristic(attrs);

  const boundingRect = {
    x: 0,
    y: (y + dy) - (textMeasure.height * 0.75), // Magic number for alphabetical baseline
    width: calWidth,
    height: textMeasure.height
  };

  const anchor = attrs['text-anchor'] || attrs.anchor;

  if (anchor === 'middle') {
    boundingRect.x = (x + dx) - (calWidth / 2);
  } else if (anchor === 'end') {
    boundingRect.x = (x + dx) - calWidth;
  } else {
    boundingRect.x = x + dx;
  }

  return boundingRect;
}

/**
 * Calculates the bounding rectangle of a text node. Including any line breaks.
 * @ignore
 * @param {object} node
 * @param {string} node.text - Text to measure
 * @param {number} [node.x=0] - X-coordinate
 * @param {number} [node.y=0] - Y-coordinate
 * @param {number} [node.dx=0] - Delta x-coordinate
 * @param {number} [node.dy=0] - Delta y-coordinate
 * @param {string} [node.anchor='start'] - Text anchor
 * @param {string} [node.fontSize] - Font size
 * @param {string} [node.fontFamily] - Font family
 * @param {string} [node['font-size']] - Font size
 * @param {string} [node['font-family']] - Font family
 * @param {string} [node.wordBreak] - Word-break option
 * @param {number} [node.maxWidth] - Maximum allowed text width
 * @param {number} [node.maxHeight] - Maximum allowed text height. If both maxLines and maxHeight are set, the property that results in the fewest number of lines is used
 * @param {number} [node.maxLines] - Maximum number of lines allowed.
 * @param {number} [node.lineHeight=1.2] - Line height
 * @param {function} [measureFn] - Optional text measure function
 * @return {object} The bounding rectangle
 */
export function textBounds(node, measureFn = measureText) {
  const lineBreakFn = resolveLineBreakAlgorithm(node);
  if (lineBreakFn) {
    const fontSize = node['font-size'] || node.fontSize;
    const fontFamily = node['font-family'] || node.fontFamily;
    const resolvedLineBreaks = lineBreakFn(node, text => measureFn({ text, fontFamily, fontSize }));
    const nodeCopy = extend({}, node);
    let maxWidth = 0;
    let widestLine = '';
    for (let i = 0, len = resolvedLineBreaks.lines.length; i < len; i++) {
      let line = resolvedLineBreaks.lines[i];
      line += i === len - 1 && resolvedLineBreaks.reduced ? ELLIPSIS_CHAR : '';
      const width = measureFn({ text: line, fontSize, fontFamily }).width;
      if (width >= maxWidth) {
        maxWidth = width;
        widestLine = line;
      }
    }
    nodeCopy.text = widestLine;
    const bounds = calcTextBounds(nodeCopy, measureFn);
    const lineHeight = bounds.height * Math.max(isNaN(node.lineHeight) ? DEFAULT_LINE_HEIGHT : node.lineHeight, 0);
    const diff = lineHeight - bounds.height;

    bounds.height = (bounds.height + diff) * resolvedLineBreaks.lines.length;

    return bounds;
  }

  return calcTextBounds(node, measureFn);
}
