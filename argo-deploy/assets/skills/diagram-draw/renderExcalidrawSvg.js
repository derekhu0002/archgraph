#!/usr/bin/env node
'use strict';

/**
 * Render a subset of Excalidraw JSON v2 elements to a standalone SVG file.
 *
 * Usage:
 *   node .github/skills/diagram-draw/renderExcalidrawSvg.js <input.excalidraw> [output.svg]
 *
 * Supported element types: rectangle, ellipse, diamond, line, arrow, text.
 * Text supports `\n` line breaks and textAlign/verticalAlign centering.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_VIEWBOX = { x: 0, y: 0, width: 1400, height: 760 };

function attr(attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}="${escapeXml(String(value))}"`)
    .join(' ');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paintAttributes(el) {
  const dash = el.strokeStyle === 'dashed' ? '6 4' : el.strokeStyle === 'dotted' ? '2 4' : undefined;
  return {
    fill: el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : 'none',
    stroke: el.strokeColor || '#1e1e1e',
    'stroke-width': el.strokeWidth || 1,
    'stroke-dasharray': dash,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    opacity: typeof el.opacity === 'number' ? el.opacity / 100 : 1,
  };
}

function renderRectangle(el) {
  const roundness = el.roundness && el.roundness.type === 3 ? Math.min(el.width, el.height) * 0.15 : 0;
  return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${roundness}" ${attr(paintAttributes(el))} />`;
}

function renderEllipse(el) {
  return `<ellipse cx="${el.x + el.width / 2}" cy="${el.y + el.height / 2}" rx="${el.width / 2}" ry="${el.height / 2}" ${attr(paintAttributes(el))} />`;
}

function renderDiamond(el) {
  const points = [
    `${el.x + el.width / 2},${el.y}`,
    `${el.x + el.width},${el.y + el.height / 2}`,
    `${el.x + el.width / 2},${el.y + el.height}`,
    `${el.x},${el.y + el.height / 2}`,
  ].join(' ');
  return `<polygon points="${points}" ${attr(paintAttributes(el))} />`;
}

function absolutePoints(el) {
  return (el.points || []).map(([px, py]) => [el.x + px, el.y + py]);
}

function renderLine(el, isArrow) {
  const points = absolutePoints(el);
  if (points.length < 2) return '';
  const polyline = points.map(([x, y]) => `${x},${y}`).join(' ');
  const marker = isArrow && el.endArrowhead ? ' marker-end="url(#arrowhead)"' : '';
  return `<polyline points="${polyline}" ${attr(paintAttributes(el))}${marker} />`;
}

function renderText(el) {
  const lines = String(el.text || '').split('\n');
  const fontSize = el.fontSize || 16;
  const lineHeight = (el.lineHeight || 1.25) * fontSize;
  const anchor = el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start';
  const x =
    anchor === 'middle' ? el.x + el.width / 2 : anchor === 'end' ? el.x + el.width : el.x;

  let firstBaseline;
  if (el.verticalAlign === 'middle') {
    firstBaseline = el.y + el.height / 2 - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.75;
  } else if (el.verticalAlign === 'bottom') {
    firstBaseline = el.y + el.height - (lines.length - 1) * lineHeight - fontSize * 0.25;
  } else {
    firstBaseline = el.y + fontSize;
  }

  const tspans = lines
    .map((line, index) => {
      const dy = index === 0 ? '' : ` dy="${lineHeight}"`;
      return `<tspan x="${x}"${dy}>${escapeXml(line)}</tspan>`;
    })
    .join('');

  return `<text x="${x}" y="${firstBaseline}" text-anchor="${anchor}" font-family="ui-monospace, 'Cascadia Code', Consolas, monospace" font-size="${fontSize}" fill="${el.strokeColor || '#1e1e1e'}" style="white-space: pre;">${tspans}</text>`;
}

function renderElement(el) {
  switch (el.type) {
    case 'rectangle':
      return renderRectangle(el);
    case 'ellipse':
      return renderEllipse(el);
    case 'diamond':
      return renderDiamond(el);
    case 'line':
      return renderLine(el, false);
    case 'arrow':
      return renderLine(el, true);
    case 'text':
      return renderText(el);
    default:
      return '';
  }
}

function computeViewBox(document) {
  if (!Array.isArray(document.elements) || document.elements.length === 0) return DEFAULT_VIEWBOX;
  const xs = [];
  const ys = [];
  for (const el of document.elements) {
    if (el.type === 'line' || el.type === 'arrow') {
      for (const [x, y] of absolutePoints(el)) {
        xs.push(x);
        ys.push(y);
      }
    } else {
      xs.push(el.x);
      ys.push(el.y);
      if (typeof el.width === 'number') xs.push(el.x + el.width);
      if (typeof el.height === 'number') ys.push(el.y + el.height);
    }
  }
  const minX = Math.min(...xs) - 20;
  const minY = Math.min(...ys) - 20;
  const maxX = Math.max(...xs) + 20;
  const maxY = Math.max(...ys) + 20;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function render(document) {
  const viewBox = computeViewBox(document);
  const body = (document.elements || []).map(renderElement).filter(Boolean).join('\n  ');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg"',
    `  viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"`,
    '  width="100%"',
    '  style="background:#ffffff; max-width: 1100px;">',
    '  <defs>',
    '    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">',
    '      <path d="M0,0 L0,6 L9,3 z" fill="#3b5bdb" />',
    '    </marker>',
    '  </defs>',
    `  ${body}`,
    '</svg>',
    '',
  ].join('\n');
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node .github/skills/diagram-draw/renderExcalidrawSvg.js <input.excalidraw> [output.svg]');
    process.exit(1);
  }
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(process.argv[3] || inputPath.replace(/\.excalidraw$/, '.svg'));
  const document = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  fs.writeFileSync(outputPath, render(document), 'utf8');
  console.log(`Rendered ${path.basename(outputPath)} from ${path.basename(inputPath)}`);
}

main();
