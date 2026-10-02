(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'graph-studio.graph.v1';
  const VIEW_WIDTH = 1200;
  const VIEW_HEIGHT = 800;
  const MAX_HISTORY = 80;
  const COLORS = [
    { hex: '#FFFFFF', name: '白色' },
    { hex: '#000000', name: '黑色' },
    { hex: '#EF4444', name: '红色' },
    { hex: '#F97316', name: '橙色' },
    { hex: '#F59E0B', name: '琥珀' },
    { hex: '#EAB308', name: '黄色' },
    { hex: '#84CC16', name: '青柠' },
    { hex: '#22C55E', name: '绿色' },
    { hex: '#10B981', name: '翡翠' },
    { hex: '#14B8A6', name: '蓝绿' },
    { hex: '#06B6D4', name: '青色' },
    { hex: '#0EA5E9', name: '天蓝' },
    { hex: '#3B82F6', name: '蓝色' },
    { hex: '#6366F1', name: '靛蓝' },
    { hex: '#8B5CF6', name: '紫罗兰' },
    { hex: '#EC4899', name: '粉色' },
  ];
  const COLOR_SET = new Set(COLORS.map((color) => color.hex));

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const svg = $('#graph-canvas');
  const world = $('#world');
  const canvasSurface = $('.canvas-surface');
  const inspectorContent = $('#inspector-content');
  const exportMenu = $('#export-menu');
  const hiddenFileInput = $('#import-file');
  const nodeCountEl = $('#node-count');
  const edgeCountEl = $('#edge-count');
  const graphTitleEl = $('#document-title');
  const saveStatusEl = $('#save-status');
  const zoomLabelEl = $('#zoom-label');
  const modeHintEl = $('#mode-hint');
  const connectToast = $('#connect-toast');
  const emptyPrompt = $('#empty-canvas-prompt');

  const measurementCanvas = document.createElement('canvas');
  const measureContext = measurementCanvas.getContext('2d');

  let graph = loadGraph();
  let selected = null;
  let mode = 'select';
  let pendingFrom = null;
  let inspectorTab = 'create';
  let createEdgeDefaults = { from: '', to: '', directed: true, style: 'solid' };
  let camera = { x: 0, y: 0, scale: 1 };
  let drag = null;
  let suppressNextClick = false;
  let activeEditBaseline = null;
  let undoStack = [];
  let redoStack = [];
  let toastTimer = 0;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function safeColor(value, fallback) {
    return COLOR_SET.has(value) ? value : fallback;
  }

  function freshSampleGraph() {
    const nodes = [
      { id: 'v1', label: 'S', weight: '起点', x: 280, y: 412, color: '#FFFFFF', borderColor: '#000000', borderWidth: 2 },
      { id: 'v2', label: 'A', weight: '12', x: 485, y: 245, color: '#FFFFFF', borderColor: '#000000', borderWidth: 2 },
      { id: 'v3', label: 'B', weight: '工厂', x: 500, y: 548, color: '#FFFFFF', borderColor: '#000000', borderWidth: 2 },
      { id: 'v4', label: 'C', weight: '−3', x: 755, y: 405, color: '#FFFFFF', borderColor: '#000000', borderWidth: 2 },
      { id: 'v5', label: 'T', weight: '终点', x: 1000, y: 405, color: '#FFFFFF', borderColor: '#000000', borderWidth: 2 },
    ];
    const pointDistance = (from, to) => {
      const a = nodes.find((node) => node.id === from);
      const b = nodes.find((node) => node.id === to);
      return Math.round(Math.hypot(b.x - a.x, b.y - a.y));
    };
    const edges = [
      { id: 'e1', from: 'v1', to: 'v2', directed: true, style: 'solid', color: '#3B82F6', weight: '5', length: pointDistance('v1', 'v2') },
      { id: 'e2', from: 'v1', to: 'v2', directed: false, style: 'dashed', color: '#F59E0B', weight: '备用', length: pointDistance('v1', 'v2') },
      { id: 'e3', from: 'v1', to: 'v3', directed: true, style: 'dashed', color: '#14B8A6', weight: '2.5', length: pointDistance('v1', 'v3') },
      { id: 'e4', from: 'v2', to: 'v3', directed: false, style: 'solid', color: '#8B5CF6', weight: '≈ 8', length: pointDistance('v2', 'v3') },
      { id: 'e5', from: 'v2', to: 'v4', directed: true, style: 'solid', color: '#0EA5E9', weight: '12', length: pointDistance('v2', 'v4') },
      { id: 'e6', from: 'v3', to: 'v4', directed: true, style: 'dashed', color: '#F97316', weight: '文字权重', length: pointDistance('v3', 'v4') },
      { id: 'e7', from: 'v4', to: 'v5', directed: true, style: 'solid', color: '#6366F1', weight: '8', length: pointDistance('v4', 'v5') },
      { id: 'e8', from: 'v5', to: 'v5', directed: false, style: 'dashed', color: '#EC4899', weight: '回路', length: 132 },
    ];
    return { name: '路径与流量 · 示例图', nodes, edges };
  }

  function sanitizeGraph(input) {
    if (!input || typeof input !== 'object') throw new Error('文件内容不是有效的图数据。');
    if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) throw new Error('JSON 中需要包含 nodes 和 edges 数组。');

    const usedNodeIds = new Set();
    const nodes = input.nodes.map((item, index) => {
      const rawId = typeof item?.id === 'string' || typeof item?.id === 'number' ? String(item.id) : `v${index + 1}`;
      let id = rawId || `v${index + 1}`;
      if (usedNodeIds.has(id)) id = `${id}-${index + 1}`;
      usedNodeIds.add(id);
      return {
        id,
        label: typeof item?.label === 'string' ? item.label : `V${index + 1}`,
        weight: typeof item?.weight === 'string' ? item.weight : (item?.weight == null ? '' : String(item.weight)),
        x: Number.isFinite(Number(item?.x)) ? Number(item.x) : 120 + (index % 5) * 150,
        y: Number.isFinite(Number(item?.y)) ? Number(item.y) : 120 + Math.floor(index / 5) * 150,
        color: safeColor(item?.color, '#FFFFFF'),
        borderColor: safeColor(item?.borderColor, '#000000'),
        borderWidth: clamp(Number.isFinite(Number(item?.borderWidth)) ? Number(item.borderWidth) : 2, 0, 8),
      };
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const usedEdgeIds = new Set();
    const edges = input.edges.map((item, index) => {
      const rawId = typeof item?.id === 'string' || typeof item?.id === 'number' ? String(item.id) : `e${index + 1}`;
      let id = rawId || `e${index + 1}`;
      if (usedEdgeIds.has(id)) id = `${id}-${index + 1}`;
      usedEdgeIds.add(id);
      const from = String(item?.from ?? '');
      const to = String(item?.to ?? '');
      if (!nodeIds.has(from) || !nodeIds.has(to)) return null;
      return {
        id,
        from,
        to,
        directed: item?.directed !== false,
        style: item?.style === 'dashed' ? 'dashed' : 'solid',
        color: safeColor(item?.color, '#000000'),
        weight: typeof item?.weight === 'string' ? item.weight : (item?.weight == null ? '' : String(item.weight)),
        length: clamp(Number.isFinite(Number(item?.length)) ? Math.round(Number(item.length)) : 180, 60, 700),
      };
    }).filter(Boolean);

    return {
      name: typeof input.name === 'string' && input.name.trim() ? input.name : '未命名图',
      nodes,
      edges,
    };
  }

  function loadGraph() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const loaded = sanitizeGraph(JSON.parse(saved));
        const legacySampleColors = [
          ['#3B82F6', '#000000', 3.5],
          ['#14B8A6', '#10B981', 2.5],
          ['#F59E0B', '#F97316', 4],
          ['#8B5CF6', '#6366F1', 2.5],
          ['#EF4444', '#EC4899', 3],
        ];
        const isUntouchedLegacySample = loaded.name === '路径与流量 · 示例图'
          && loaded.nodes.length === 5
          && loaded.nodes.every((node, index) => {
            const sampleNode = freshSampleGraph().nodes[index];
            const [fill, border, width] = legacySampleColors[index];
            return node.id === sampleNode.id && node.label === sampleNode.label
              && node.color === fill && node.borderColor === border && node.borderWidth === width;
          });
        if (isUntouchedLegacySample) {
          loaded.nodes.forEach((node) => {
            node.color = '#FFFFFF';
            node.borderColor = '#000000';
            node.borderWidth = 2;
          });
        }
        return loaded;
      }
    } catch (error) {
      console.warn('Unable to load the locally saved graph:', error);
    }
    return freshSampleGraph();
  }

  function persistGraph() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
      saveStatusEl.textContent = '本地自动保存';
      $('.status-dot').style.background = '#49b898';
    } catch (error) {
      saveStatusEl.textContent = '无法保存到本地';
      $('.status-dot').style.background = '#e5a052';
    }
  }

  function pushUndo(snapshot) {
    undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function finishEdit() {
    if (!activeEditBaseline) return;
    const before = activeEditBaseline;
    activeEditBaseline = null;
    if (JSON.stringify(before) !== JSON.stringify(graph)) pushUndo(before);
    persistGraph();
    updateHeader();
    updateHistoryButtons();
  }

  function beginEdit() {
    if (!activeEditBaseline) {
      activeEditBaseline = clone(graph);
      updateHistoryButtons();
    }
  }

  function commitMutation(action) {
    finishEdit();
    const before = clone(graph);
    action();
    if (JSON.stringify(before) === JSON.stringify(graph)) return;
    pushUndo(before);
    renderAll();
  }

  function undo() {
    finishEdit();
    if (!undoStack.length) return;
    redoStack.push(clone(graph));
    graph = undoStack.pop();
    selected = selected && selectionExists(selected) ? selected : null;
    pendingFrom = null;
    updateHistoryButtons();
    renderAll();
  }

  function redo() {
    finishEdit();
    if (!redoStack.length) return;
    undoStack.push(clone(graph));
    graph = redoStack.pop();
    selected = selected && selectionExists(selected) ? selected : null;
    pendingFrom = null;
    updateHistoryButtons();
    renderAll();
  }

  function selectionExists(selection) {
    if (!selection) return false;
    return selection.type === 'node'
      ? graph.nodes.some((node) => node.id === selection.id)
      : graph.edges.some((edge) => edge.id === selection.id);
  }

  function updateHistoryButtons() {
    $('#undo-button').disabled = undoStack.length === 0 && !activeEditBaseline;
    $('#redo-button').disabled = redoStack.length === 0;
  }

  function updateHeader() {
    graphTitleEl.textContent = graph.name || '未命名图';
    graphTitleEl.title = graph.name || '未命名图';
    nodeCountEl.textContent = String(graph.nodes.length);
    edgeCountEl.textContent = String(graph.edges.length);
    $('#structure-count').textContent = String(graph.nodes.length + graph.edges.length);
  }

  function svgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    });
    return element;
  }

  function measureText(text, font) {
    if (!measureContext) return String(text).length * 8;
    measureContext.font = font;
    return measureContext.measureText(String(text)).width;
  }

  function nodeRadius() {
    if (!graph.nodes.length) return 31;
    let widest = 0;
    let hasSecondaryLine = false;
    graph.nodes.forEach((node) => {
      const label = node.label || ' ';
      const weight = node.weight || '';
      widest = Math.max(widest, measureText(label, '700 14px DM Sans, sans-serif'));
      if (weight) {
        hasSecondaryLine = true;
        widest = Math.max(widest, measureText(weight, '600 10.5px DM Sans, sans-serif'));
      }
    });
    return Math.max(30, widest / 2 + 18, hasSecondaryLine ? 31 : 0);
  }

  function readableTextColor(hex) {
    const value = hex.replace('#', '');
    const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255).map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    return luminance > 0.25 ? '#233044' : '#ffffff';
  }

  function pointForQuadratic(start, control, end, t) {
    const inverse = 1 - t;
    return {
      x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
    };
  }

  function pointForCubic(start, first, second, end, t) {
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * first.x + 3 * inverse * t ** 2 * second.x + t ** 3 * end.x,
      y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * first.y + 3 * inverse * t ** 2 * second.y + t ** 3 * end.y,
    };
  }

  function unitVector(x, y) {
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
  }

  function edgeGeometry(edge, groupIndex, groupSize, radius) {
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    if (!from || !to) return null;

    if (from.id === to.id) {
      const expanded = Math.max(58, edge.length * 0.57) + groupIndex * 19;
      const start = { x: from.x - radius * 0.55, y: from.y - radius * 0.82 };
      const end = { x: from.x + radius * 0.55, y: from.y - radius * 0.82 };
      const first = { x: from.x - radius - expanded * 0.42, y: from.y - radius - expanded };
      const second = { x: from.x + radius + expanded * 0.42, y: from.y - radius - expanded };
      const label = pointForCubic(start, first, second, end, 0.5);
      return {
        path: `M ${start.x} ${start.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${end.x} ${end.y}`,
        label,
        arrowTip: end,
        arrowDirection: unitVector(end.x - second.x, end.y - second.y),
      };
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const centerDistance = Math.hypot(dx, dy) || 1;
    const canonicalSign = String(from.id).localeCompare(String(to.id)) <= 0 ? 1 : -1;
    const perpendicular = { x: (-dy / centerDistance) * canonicalSign, y: (dx / centerDistance) * canonicalSign };
    const offset = (groupIndex - (groupSize - 1) / 2) * 38;
    const control = {
      x: (from.x + to.x) / 2 + perpendicular.x * offset,
      y: (from.y + to.y) / 2 + perpendicular.y * offset,
    };
    const startDirection = unitVector(control.x - from.x, control.y - from.y);
    const endDirection = unitVector(to.x - control.x, to.y - control.y);
    const fromRadius = radius + from.borderWidth / 2 + 2;
    const toRadius = radius + to.borderWidth / 2 + 2;
    const start = { x: from.x + startDirection.x * fromRadius, y: from.y + startDirection.y * fromRadius };
    const end = { x: to.x - endDirection.x * toRadius, y: to.y - endDirection.y * toRadius };
    return {
      path: `M ${start.x} ${start.y} Q ${control.x} ${control.y}, ${end.x} ${end.y}`,
      label: pointForQuadratic(start, control, end, 0.5),
      arrowTip: end,
      arrowDirection: unitVector(end.x - control.x, end.y - control.y),
    };
  }

  function arrowPolygon(tip, direction, size = 12) {
    const normal = { x: -direction.y, y: direction.x };
    const base = { x: tip.x - direction.x * size, y: tip.y - direction.y * size };
    const wing = size * 0.48;
    const left = { x: base.x + normal.x * wing, y: base.y + normal.y * wing };
    const right = { x: base.x - normal.x * wing, y: base.y - normal.y * wing };
    return `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`;
  }

  function renderEdge(edge, groupIndex, groupSize, radius) {
    const geometry = edgeGeometry(edge, groupIndex, groupSize, radius);
    if (!geometry) return null;
    const group = svgElement('g', { class: 'graph-edge', 'data-id': edge.id });
    const isSelected = selected?.type === 'edge' && selected.id === edge.id;
    const width = isSelected ? 3.1 : 2.5;

    if (isSelected) {
      group.appendChild(svgElement('path', { class: 'edge-selection-halo', d: geometry.path }));
    }
    group.appendChild(svgElement('path', { class: 'edge-hit', d: geometry.path }));
    const visible = svgElement('path', {
      class: 'edge-visible',
      d: geometry.path,
      stroke: edge.color,
      'stroke-width': width,
      opacity: edge.style === 'dashed' ? 0.9 : 0.86,
    });
    if (edge.style === 'dashed') visible.setAttribute('stroke-dasharray', '8 7');
    group.appendChild(visible);

    if (edge.directed) {
      group.appendChild(svgElement('polygon', {
        points: arrowPolygon(geometry.arrowTip, geometry.arrowDirection),
        fill: edge.color,
        class: 'edge-arrow',
      }));
    }

    if (edge.weight) {
      const labelGroup = svgElement('g', {
        class: 'edge-label',
        transform: `translate(${geometry.label.x} ${geometry.label.y})`,
      });
      const textWidth = measureText(edge.weight, '700 12px DM Sans, sans-serif');
      const width = Math.max(31, textWidth + 17);
      labelGroup.appendChild(svgElement('rect', {
        class: 'edge-label-bg',
        x: -width / 2,
        y: -11,
        width,
        height: 22,
        rx: 7,
        stroke: edge.color,
        'stroke-opacity': 0.26,
      }));
      const labelText = svgElement('text', { class: 'edge-label-text', fill: '#3F4D63', x: 0, y: 0 });
      labelText.textContent = edge.weight;
      labelGroup.appendChild(labelText);
      group.appendChild(labelGroup);
    }
    return group;
  }

  function renderNode(node, radius) {
    const group = svgElement('g', { class: 'graph-node', 'data-id': node.id, transform: `translate(${node.x} ${node.y})` });
    const isSelected = selected?.type === 'node' && selected.id === node.id;
    const isConnectOrigin = pendingFrom === node.id;
    if (isSelected) group.appendChild(svgElement('circle', { class: 'node-selection-ring', r: radius + 8 }));
    if (isConnectOrigin) group.appendChild(svgElement('circle', { class: 'node-connect-ring', r: radius + 5 }));

    group.appendChild(svgElement('circle', {
      class: 'node-base',
      r: radius,
      fill: node.color,
      stroke: node.borderWidth > 0 ? node.borderColor : 'none',
      'stroke-width': node.borderWidth,
    }));

    const textColor = readableTextColor(node.color);
    const label = svgElement('text', {
      class: 'node-label',
      x: 0,
      y: node.weight ? -4 : 1,
      fill: textColor,
      'dominant-baseline': 'central',
    });
    label.textContent = node.label || ' ';
    group.appendChild(label);

    if (node.weight) {
      const weight = svgElement('text', {
        class: 'node-weight',
        x: 0,
        y: 13,
        fill: textColor,
        'dominant-baseline': 'central',
      });
      weight.textContent = node.weight;
      group.appendChild(weight);
    }
    return group;
  }

  function renderScene() {
    const radius = nodeRadius();
    const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const groups = new Map();
    graph.edges.forEach((edge) => {
      const fromIndex = nodeOrder.get(edge.from) ?? 0;
      const toIndex = nodeOrder.get(edge.to) ?? 0;
      const key = edge.from === edge.to
        ? `loop:${edge.from}`
        : `pair:${Math.min(fromIndex, toIndex)}:${Math.max(fromIndex, toIndex)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(edge);
    });

    const fragments = document.createDocumentFragment();
    groups.forEach((edges) => edges.forEach((edge, index) => {
      const element = renderEdge(edge, index, edges.length, radius);
      if (element) fragments.appendChild(element);
    }));
    graph.nodes.forEach((node) => fragments.appendChild(renderNode(node, radius)));
    world.replaceChildren(fragments);
    world.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);
    canvasSurface.dataset.mode = mode;
    emptyPrompt.hidden = graph.nodes.length !== 0;
    $('#canvas-background').classList.toggle('grid-hidden', !$('#grid-toggle').classList.contains('is-on'));
    updateZoomLabel();
    updateModeUi();
  }

  function renderPalette(field, value) {
    return `<div class="color-palette" role="group" aria-label="${field === 'node.color' ? '顶点填充色' : field === 'node.borderColor' ? '顶点边框色' : '边颜色'}">${COLORS.map((color) => `
      <button class="color-swatch${value === color.hex ? ' selected' : ''}" type="button" style="--swatch:${color.hex}" title="${color.name}" aria-label="${color.name}" aria-pressed="${value === color.hex}" data-palette-field="${field}" data-color="${color.hex}"></button>
    `).join('')}</div>`;
  }

  function renderGraphOverview() {
    return `
      <p class="overview-intro">轻松创建有向、无向或混合图。顶点与边的权重支持任意文本。</p>
      <label class="graph-name-field">
        <span>图名称</span>
        <input class="text-input" type="text" maxlength="100" placeholder="给这张图起个名字" value="${escapeHtml(graph.name)}" data-field="graph.name" />
      </label>
      <div class="stats-grid">
        <div class="stat-card"><span>顶点数量</span><strong>${graph.nodes.length}</strong><small>所有顶点统一自适应尺寸</small></div>
        <div class="stat-card"><span>边数量</span><strong>${graph.edges.length}</strong><small>支持重边与自环</small></div>
      </div>
      <div class="eyebrow-label">按标签快速输入</div>
      <div class="quick-actions">
        <button class="quick-action" type="button" data-open-tab="create">
          <span class="quick-action-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg></span>
          <span><strong>输入顶点 u</strong><small>创建白底黑边顶点</small></span>
        </button>
        <button class="quick-action" type="button" data-open-tab="create">
          <span class="quick-action-icon"><svg viewBox="0 0 24 24"><circle cx="6" cy="17.5" r="3"/><circle cx="18" cy="6.5" r="3"/><path d="m8.2 15.5 7.6-7"/></svg></span>
          <span><strong>输入边 u v w</strong><small>支持文本权重与重边</small></span>
        </button>
      </div>
      <div class="eyebrow-label">编辑提示</div>
      <ul class="keyboard-list">
        <li><span>选择与拖动</span><kbd>V</kbd></li>
        <li><span>添加顶点</span><kbd>N</kbd></li>
        <li><span>连接顶点</span><kbd>E</kbd></li>
        <li><span>撤销 / 重做</span><kbd>⌘ Z</kbd></li>
        <li><span>删除所选元素</span><kbd>Del</kbd></li>
      </ul>
      <div class="support-card">
        <div class="support-card-title"><i>✦</i> 为复杂图而设计</div>
        <p>16 种颜色、实线 / 虚线、有向 / 无向边可混用。支持字符串权重、可调边长、加粗彩色边框、重边与自环。</p>
      </div>
    `;
  }

  function renderCreatePanel() {
    const nodeOptions = graph.nodes.map((node) => `
      <option value="${escapeHtml(node.label)}"></option>
      <option value="${escapeHtml(node.id)}">${escapeHtml(node.label || '未命名顶点')} · ID</option>
    `).join('');
    return `
      <p class="create-intro">按 CS Academy 常见的端点输入方式创建图：添加顶点输入 <code>u</code>，添加边输入 <code>u v w</code>。</p>
      <section class="create-card">
        <div class="create-card-heading">
          <span class="create-card-icon node-create-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg></span>
          <span><strong>添加顶点</strong><small>输入一个唯一标签 u</small></span>
        </div>
        <form id="add-node-form" class="create-form" autocomplete="off">
          <label class="field-label" for="new-node-label">顶点标签 <code>u</code></label>
          <div class="create-input-row">
            <input id="new-node-label" class="text-input create-main-input" name="label" type="text" maxlength="120" placeholder="例如：u、A、入口" required />
            <button class="create-submit node-submit" type="submit"><span>＋</span>加点</button>
          </div>
          <p class="create-help">新顶点默认为白底、黑边、黑字；创建后点击顶点可编辑点权和颜色。</p>
        </form>
      </section>
      <section class="create-card edge-create-card">
        <div class="create-card-heading">
          <span class="create-card-icon edge-create-icon"><svg viewBox="0 0 24 24"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="7" r="3"/><path d="m8.3 14.8 7.4-5.6m-2 .1 2 .1-.1 2"/></svg></span>
          <span><strong>添加边</strong><small>端点标签 / ID 与边权 w</small></span>
        </div>
        <form id="add-edge-form" class="create-form" autocomplete="off">
          <datalist id="vertex-options">${nodeOptions}</datalist>
          <div class="edge-input-grid">
            <label><span>起点 <code>u</code></span><input class="text-input" name="from" type="text" list="vertex-options" placeholder="u" value="${escapeHtml(createEdgeDefaults.from)}" required /></label>
            <label><span>终点 <code>v</code></span><input class="text-input" name="to" type="text" list="vertex-options" placeholder="v" value="${escapeHtml(createEdgeDefaults.to)}" required /></label>
            <label class="weight-input-label"><span>边权 <code>w</code></span><input class="text-input" name="weight" type="text" maxlength="120" placeholder="任意文本" /></label>
          </div>
          <div class="create-option-row">
            <label><span>方向</span><select class="select-input" name="direction"><option value="directed"${createEdgeDefaults.directed ? ' selected' : ''}>有向</option><option value="undirected"${!createEdgeDefaults.directed ? ' selected' : ''}>无向</option></select></label>
            <label><span>线型</span><select class="select-input" name="style"><option value="solid"${createEdgeDefaults.style === 'solid' ? ' selected' : ''}>实线</option><option value="dashed"${createEdgeDefaults.style === 'dashed' ? ' selected' : ''}>虚线</option></select></label>
          </div>
          <button class="create-submit edge-submit" type="submit"><svg viewBox="0 0 24 24"><path d="M4 12h15m-5-5 5 5-5 5"/></svg>加边 <code>u v w</code></button>
          <p class="create-help">默认黑色有向实线。重复输入可创建重边；<code>u = v</code> 可创建自环。边权可为任意字符串。</p>
        </form>
      </section>
      <div class="create-tip"><span>ⓘ</span> 端点可输入顶点标签，也可使用图结构列表中的顶点 ID。</div>
    `;
  }

  function renderNodeInspector(node) {
    const radius = nodeRadius();
    return `
      <div class="selection-card">
        <div class="selection-symbol"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg></div>
        <div class="selection-copy"><strong>${escapeHtml(node.label || '未命名顶点')}</strong><span>顶点 ID · ${escapeHtml(node.id)}</span></div>
      </div>
      <div class="section-block first-block">
        <div class="section-title">基本信息 <small>字符串</small></div>
        <label class="property-field"><span class="field-label">标签</span><input class="text-input" type="text" maxlength="120" value="${escapeHtml(node.label)}" placeholder="例如：A、入口、节点一" data-field="node.label" /></label>
        <label class="property-field"><span class="field-label">点权 <span class="field-subtitle">可留空</span></span><input class="text-input" type="text" maxlength="120" value="${escapeHtml(node.weight)}" placeholder="任意文本，例如：起点、∞、cost" data-field="node.weight" /></label>
      </div>
      <div class="section-block">
        <div class="section-title">填充颜色 <small>16 色</small></div>
        ${renderPalette('node.color', node.color)}
      </div>
      <div class="section-block">
        <div class="section-title">边框样式 <small>颜色与粗细独立设置</small></div>
        <div class="field-label" style="margin-bottom:8px">边框颜色</div>
        ${renderPalette('node.borderColor', node.borderColor)}
        <label class="property-field" style="margin-top:13px;margin-bottom:4px">
          <span class="field-label">边框粗细 <span class="range-value" id="border-width-readout">${formatWidth(node.borderWidth)}</span></span>
          <span class="range-wrap"><input type="range" min="0" max="8" step="0.5" value="${node.borderWidth}" data-field="node.borderWidth" aria-label="边框粗细" /></span>
        </label>
      </div>
      <div class="section-block">
        <div class="section-title">尺寸规则</div>
        <div class="node-size-readout"><span>统一顶点直径 · 随内容自适应</span><strong id="node-size-readout">${Math.round(radius * 2)} px</strong></div>
        <p class="inline-hint"><i>ⓘ</i><span>所有顶点保持同一尺寸；最长标签或点权变长时，整体尺寸会自动放大，避免文字贴近边缘。</span></p>
      </div>
      ${deleteButton('删除顶点及其关联边')}
    `;
  }

  function renderEdgeInspector(edge) {
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    const radius = nodeRadius();
    const minLength = Math.max(70, Math.ceil(radius * 2 + 22));
    const maxLength = Math.max(700, minLength + 500);
    const length = clamp(Math.round(edge.length), minLength, maxLength);
    const fromLabel = from?.label || edge.from;
    const toLabel = to?.label || edge.to;
    const isLoop = edge.from === edge.to;
    return `
      <div class="selection-card">
        <div class="selection-symbol"><svg viewBox="0 0 24 24"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="7" r="3"/><path d="m8.3 14.8 7.4-5.6"/><path d="m13.7 9.1 2 .1-.1 2"/></svg></div>
        <div class="selection-copy"><strong>${isLoop ? `${escapeHtml(fromLabel)} 的自环` : `${escapeHtml(fromLabel)} → ${escapeHtml(toLabel)}`}</strong><span>边 ID · ${escapeHtml(edge.id)}</span></div>
      </div>
      ${!isLoop ? `<div class="edge-summary-line"><strong>${escapeHtml(fromLabel)}</strong><span class="edge-direction">${edge.directed ? '→' : '—'}</span><strong>${escapeHtml(toLabel)}</strong>${edge.directed ? `<button class="reverse-button" type="button" data-action="reverse-edge" title="交换起点和终点"><svg viewBox="0 0 24 24"><path d="M4 8h15l-3-3m3 3-3 3M20 16H5l3 3m-3-3 3-3"/></svg>反转</button>` : ''}</div>` : '<div class="edge-summary-line"><span>自环 · 起点和终点为同一顶点</span></div>'}
      <div class="section-block first-block">
        <div class="section-title">边类型</div>
        <div class="segmented-control edge-type-control" role="group" aria-label="边方向">
          <button type="button" class="${edge.directed ? 'active' : ''}" data-action="set-directed" data-value="true"><svg viewBox="0 0 24 24"><path d="M4 12h15m-5-5 5 5-5 5"/></svg>有向边</button>
          <button type="button" class="${!edge.directed ? 'active' : ''}" data-action="set-directed" data-value="false"><svg viewBox="0 0 24 24"><path d="M5 12h14m-10-5-5 5 5 5m6-10 5 5-5 5"/></svg>无向边</button>
        </div>
        <div class="section-title" style="margin-top:12px">线条样式</div>
        <div class="segmented-control" role="group" aria-label="线条样式">
          <button type="button" class="${edge.style === 'solid' ? 'active' : ''}" data-action="set-style" data-value="solid"><svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg>实线</button>
          <button type="button" class="${edge.style === 'dashed' ? 'active' : ''}" data-action="set-style" data-value="dashed"><svg viewBox="0 0 24 24"><path d="M4 12h4m4 0h4m4 0h0"/></svg>虚线</button>
        </div>
      </div>
      <div class="section-block">
        <div class="section-title">边权 <small>字符串</small></div>
        <label class="property-field"><span class="field-label">显示在边上的文本</span><input class="text-input" type="text" maxlength="120" value="${escapeHtml(edge.weight)}" placeholder="例如：12、cost、最短路" data-field="edge.weight" /></label>
      </div>
      <div class="section-block">
        <div class="section-title">边颜色 <small>16 色</small></div>
        ${renderPalette('edge.color', edge.color)}
      </div>
      <div class="section-block">
        <div class="section-title">${isLoop ? '自环尺寸' : '边长度'} <small>${isLoop ? '环路弧高' : '顶点中心距'}</small></div>
        <div class="length-controls">
          <label class="range-wrap"><input type="range" min="${minLength}" max="${maxLength}" step="1" value="${length}" data-field="edge.length" aria-label="${isLoop ? '自环尺寸' : '边长度'}" /></label>
          <input class="number-input" type="number" min="${minLength}" max="${maxLength}" step="1" value="${length}" data-field="edge.length" aria-label="边长度数值" />
        </div>
        <p class="inline-hint"><i>ⓘ</i><span>${isLoop ? '此数值控制自环的视觉弧高。' : '调整长度会沿当前方向移动目标顶点；也可以直接拖动顶点微调。'}</span></p>
      </div>
      ${deleteButton('删除这条边')}
    `;
  }

  function deleteButton(label) {
    return `<button type="button" class="danger-button" data-action="delete-selection"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5"/></svg>${label}</button>`;
  }

  function renderStructure() {
    const nodeRows = graph.nodes.map((node) => `
      <button type="button" class="structure-item${selected?.type === 'node' && selected.id === node.id ? ' selected' : ''}" data-select-type="node" data-select-id="${escapeHtml(node.id)}">
        <span class="structure-color" style="background:${node.color}"></span>
        <span class="structure-item-main"><strong>${escapeHtml(node.label || '未命名顶点')}</strong><small>${escapeHtml(node.weight || '无点权')} · ${escapeHtml(node.id)}</small></span>
        <span class="structure-kind">V</span>
      </button>
    `).join('');
    const edgeRows = graph.edges.map((edge) => {
      const from = graph.nodes.find((node) => node.id === edge.from);
      const to = graph.nodes.find((node) => node.id === edge.to);
      const label = edge.from === edge.to
        ? `${from?.label || edge.from} 自环`
        : `${from?.label || edge.from} ${edge.directed ? '→' : '—'} ${to?.label || edge.to}`;
      return `
        <button type="button" class="structure-item${selected?.type === 'edge' && selected.id === edge.id ? ' selected' : ''}" data-select-type="edge" data-select-id="${escapeHtml(edge.id)}">
          <span class="structure-color" style="background:${edge.color};border-radius:3px"></span>
          <span class="structure-item-main"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(edge.weight || '无边权')} · ${edge.style === 'dashed' ? '虚线' : '实线'} · ${escapeHtml(edge.id)}</small></span>
          <span class="structure-kind">${edge.directed ? '→' : '—'}</span>
        </button>
      `;
    }).join('');

    return `
      <p class="structure-intro">选择列表中的元素即可查看和编辑属性。每一条重边都可以单独设置。</p>
      <section class="structure-section">
        <div class="structure-section-head"><span>顶点</span><span>${graph.nodes.length} 个</span></div>
        <div class="structure-list">${nodeRows || '<div class="structure-empty">还没有顶点</div>'}</div>
      </section>
      <section class="structure-section">
        <div class="structure-section-head"><span>边</span><span>${graph.edges.length} 条</span></div>
        <div class="structure-list">${edgeRows || '<div class="structure-empty">还没有边</div>'}</div>
      </section>
      <ul class="keyboard-list">
        <li><span>选择工具</span><kbd>V</kbd></li><li><span>顶点工具</span><kbd>N</kbd></li><li><span>连边工具</span><kbd>E</kbd></li><li><span>撤销操作</span><kbd>Ctrl Z</kbd></li>
      </ul>
    `;
  }

  function renderInspector() {
    const heading = $('#inspector-title');
    const eyebrow = $('.panel-eyebrow');
    const clear = $('#clear-selection');
    const isCreateTab = inspectorTab === 'create';
    clear.hidden = !selected || isCreateTab;

    if (isCreateTab) {
      heading.textContent = '快速添加';
      eyebrow.textContent = 'QUICK INPUT';
    } else if (selected?.type === 'node') {
      const node = graph.nodes.find((item) => item.id === selected.id);
      heading.textContent = node ? '顶点属性' : '图属性';
      eyebrow.textContent = node ? 'VERTEX' : 'WORKSPACE';
    } else if (selected?.type === 'edge') {
      const edge = graph.edges.find((item) => item.id === selected.id);
      heading.textContent = edge ? '边属性' : '图属性';
      eyebrow.textContent = edge ? 'EDGE' : 'WORKSPACE';
    } else {
      heading.textContent = '图属性';
      eyebrow.textContent = 'WORKSPACE';
    }

    $$('.inspector-tab').forEach((tab) => {
      const isActive = tab.dataset.tab === inspectorTab;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });

    if (inspectorTab === 'create') {
      inspectorContent.innerHTML = renderCreatePanel();
      bindCreateForms();
      return;
    }

    if (inspectorTab === 'structure') {
      inspectorContent.innerHTML = renderStructure();
      $$('.structure-item', inspectorContent).forEach((button) => {
        button.addEventListener('click', () => setSelection(button.dataset.selectType, button.dataset.selectId));
      });
      return;
    }

    if (selected?.type === 'node') {
      const node = graph.nodes.find((item) => item.id === selected.id);
      inspectorContent.innerHTML = node ? renderNodeInspector(node) : renderGraphOverview();
    } else if (selected?.type === 'edge') {
      const edge = graph.edges.find((item) => item.id === selected.id);
      inspectorContent.innerHTML = edge ? renderEdgeInspector(edge) : renderGraphOverview();
    } else {
      inspectorContent.innerHTML = renderGraphOverview();
    }
    bindInspectorControls();
  }

  function bindInspectorControls() {
    $$('[data-field]', inspectorContent).forEach((control) => {
      control.addEventListener('focus', beginEdit);
      control.addEventListener('input', () => {
        if (control.type !== 'number') updateInspectorField(control);
      });
      control.addEventListener('change', () => {
        if (control.type === 'number') updateInspectorField(control);
        finishEdit();
      });
    });

    $$('.color-swatch', inspectorContent).forEach((button) => {
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        const field = button.dataset.paletteField;
        const color = button.dataset.color;
        commitMutation(() => {
          const target = getSelectedObject();
          if (target) target[field.split('.')[1]] = color;
        });
      });
    });

    $$('[data-action]', inspectorContent).forEach((button) => {
      button.addEventListener('click', () => handleInspectorAction(button.dataset.action, button.dataset.value));
    });

    $$('[data-open-tab]', inspectorContent).forEach((button) => {
      button.addEventListener('click', () => {
        finishEdit();
        inspectorTab = button.dataset.openTab;
        renderInspector();
      });
    });
  }

  function bindCreateForms() {
    const nodeForm = $('#add-node-form', inspectorContent);
    const edgeForm = $('#add-edge-form', inspectorContent);
    nodeForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const label = String(new FormData(nodeForm).get('label') ?? '').trim();
      if (!label) {
        showToast('请输入顶点标签 u。', true);
        return;
      }
      if (graph.nodes.some((node) => node.label === label)) {
        showToast(`顶点「${label}」已存在，请使用唯一标签。`, true);
        return;
      }
      addNodeByLabel(label);
    });
    edgeForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(edgeForm);
      const fromToken = String(form.get('from') ?? '').trim();
      const toToken = String(form.get('to') ?? '').trim();
      const weight = String(form.get('weight') ?? '');
      if (!fromToken || !toToken) {
        showToast('请输入边的起点 u 和终点 v。', true);
        return;
      }
      const fromResult = lookupNode(fromToken);
      const toResult = lookupNode(toToken);
      if (!fromResult.node || !toResult.node) {
        const missing = !fromResult.node ? fromToken : toToken;
        const result = !fromResult.node ? fromResult : toResult;
        showToast(result.ambiguous ? `「${missing}」对应多个顶点，请改用唯一的顶点 ID。` : `找不到顶点「${missing}」，请先添加该顶点。`, true);
        return;
      }
      createEdgeDefaults = {
        from: fromToken,
        to: toToken,
        directed: form.get('direction') !== 'undirected',
        style: form.get('style') === 'dashed' ? 'dashed' : 'solid',
      };
      addEdgeByInput(fromResult.node, toResult.node, weight, createEdgeDefaults);
    });
  }

  function lookupNode(token) {
    const byId = graph.nodes.find((node) => node.id === token);
    if (byId) return { node: byId, ambiguous: false };
    const byLabel = graph.nodes.filter((node) => node.label === token);
    if (byLabel.length === 1) return { node: byLabel[0], ambiguous: false };
    return { node: null, ambiguous: byLabel.length > 1 };
  }

  function getSelectedObject() {
    if (!selected) return null;
    return selected.type === 'node'
      ? graph.nodes.find((node) => node.id === selected.id)
      : graph.edges.find((edge) => edge.id === selected.id);
  }

  function updateInspectorField(control) {
    beginEdit();
    const field = control.dataset.field;
    const value = control.value;
    if (field === 'graph.name') {
      graph.name = value || '未命名图';
    } else {
      const target = getSelectedObject();
      if (!target) return;
      const property = field.split('.')[1];
      if (property === 'borderWidth') {
        target.borderWidth = clamp(Number(value), 0, 8);
        const readout = $('#border-width-readout', inspectorContent);
        if (readout) readout.textContent = formatWidth(target.borderWidth);
      } else if (property === 'length') {
        let length = Number(value);
        if (!Number.isFinite(length)) return;
        const min = Math.max(70, Math.ceil(nodeRadius() * 2 + 22));
        const max = Math.max(700, min + 500);
        length = clamp(Math.round(length), min, max);
        target.length = length;
        control.value = String(length);
        $$('[data-field="edge.length"]', inspectorContent).forEach((otherControl) => {
          if (otherControl !== control) otherControl.value = String(length);
        });
        if (target.from !== target.to) {
          const from = graph.nodes.find((node) => node.id === target.from);
          const to = graph.nodes.find((node) => node.id === target.to);
          if (from && to) {
            const angle = Math.atan2(to.y - from.y, to.x - from.x);
            to.x = from.x + Math.cos(angle) * length;
            to.y = from.y + Math.sin(angle) * length;
            syncEdgeLengths(to.id, target.id);
            target.length = length;
          }
        }
      } else {
        target[property] = value;
      }
    }
    renderScene();
    persistGraph();
    updateHeader();
    updateSelectionSummary();
    updateNodeSizeReadout();
  }

  function updateSelectionSummary() {
    if (!selected) return;
    const node = selected.type === 'node' ? graph.nodes.find((item) => item.id === selected.id) : null;
    const edge = selected.type === 'edge' ? graph.edges.find((item) => item.id === selected.id) : null;
    const strong = $('.selection-copy strong', inspectorContent);
    if (strong && node) strong.textContent = node.label || '未命名顶点';
    if (strong && edge) {
      const from = graph.nodes.find((item) => item.id === edge.from);
      const to = graph.nodes.find((item) => item.id === edge.to);
      strong.textContent = edge.from === edge.to
        ? `${from?.label || edge.from} 的自环`
        : `${from?.label || edge.from} ${edge.directed ? '→' : '—'} ${to?.label || edge.to}`;
    }
  }

  function updateNodeSizeReadout() {
    const readout = $('#node-size-readout', inspectorContent);
    if (readout) readout.textContent = `${Math.round(nodeRadius() * 2)} px`;
  }

  function handleInspectorAction(action, value) {
    if (action === 'delete-selection') {
      deleteSelection();
      return;
    }
    if (action === 'reverse-edge') {
      commitMutation(() => {
        const edge = getSelectedObject();
        if (edge?.from !== edge?.to) [edge.from, edge.to] = [edge.to, edge.from];
      });
      return;
    }
    if (action === 'set-directed') {
      commitMutation(() => {
        const edge = getSelectedObject();
        if (edge) edge.directed = value === 'true';
      });
      return;
    }
    if (action === 'set-style') {
      commitMutation(() => {
        const edge = getSelectedObject();
        if (edge) edge.style = value === 'dashed' ? 'dashed' : 'solid';
      });
    }
  }

  function formatWidth(value) {
    return `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)} px`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function setSelection(type, id) {
    finishEdit();
    if (!selectionExists({ type, id })) return;
    selected = { type, id };
    pendingFrom = null;
    inspectorTab = 'properties';
    renderAll();
  }

  function clearSelection() {
    finishEdit();
    selected = null;
    renderAll();
  }

  function renderAll() {
    renderScene();
    updateHeader();
    updateHistoryButtons();
    renderInspector();
    persistGraph();
  }

  function setMode(nextMode) {
    finishEdit();
    if (!['select', 'node', 'edge'].includes(nextMode)) return;
    mode = nextMode;
    pendingFrom = null;
    updateModeUi();
    renderScene();
  }

  function updateModeUi() {
    $$('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    canvasSurface.dataset.mode = mode;
    if (mode === 'node') {
      modeHintEl.innerHTML = '<span class="hint-icon">＋</span> 点击画布任意位置添加顶点 · 按 Esc 返回选择';
      connectToast.hidden = true;
    } else if (mode === 'edge') {
      modeHintEl.innerHTML = '<span class="hint-icon">↗</span> 依次点击两个顶点创建边 · 点击同一顶点创建自环';
      const node = graph.nodes.find((item) => item.id === pendingFrom);
      connectToast.textContent = node
        ? `已选择「${node.label || node.id}」作为起点，再点一个顶点完成连边。`
        : '依次点击两个顶点创建边；再次点击同一顶点可创建自环。';
      connectToast.hidden = false;
    } else {
      modeHintEl.innerHTML = '<span class="hint-icon">↖</span> 拖动顶点调整布局 · 空白处拖动画布 · 滚轮缩放画布';
      connectToast.hidden = true;
    }
  }

  function createUniqueId(prefix, items) {
    const ids = new Set(items.map((item) => String(item.id)));
    let number = 1;
    while (ids.has(`${prefix}${number}`)) number += 1;
    return `${prefix}${number}`;
  }

  function addNodeAt(point) {
    const usedLabels = new Set(graph.nodes.map((node) => node.label));
    let nodeNumber = 1;
    let label = '';
    do {
      label = nodeNumber <= 26 ? String.fromCharCode(64 + nodeNumber) : `V${nodeNumber}`;
      nodeNumber += 1;
    } while (usedLabels.has(label));
    const id = createUniqueId('v', graph.nodes);
    commitMutation(() => {
      graph.nodes.push({
        id,
        label,
        weight: '',
        x: point.x,
        y: point.y,
        color: '#FFFFFF',
        borderColor: '#000000',
        borderWidth: 2,
      });
      selected = { type: 'node', id };
      pendingFrom = null;
    });
  }

  function nextOpenPosition(label = '') {
    if (!graph.nodes.length) return { x: 600, y: 400 };
    const center = {
      x: graph.nodes.reduce((sum, node) => sum + node.x, 0) / graph.nodes.length,
      y: graph.nodes.reduce((sum, node) => sum + node.y, 0) / graph.nodes.length,
    };
    const proposedRadius = Math.max(nodeRadius(), 30, measureText(label, '700 14px DM Sans, sans-serif') / 2 + 18);
    const spacing = Math.max(150, proposedRadius * 2 + 42);
    for (let ring = 1; ring <= 20; ring += 1) {
      const candidates = ring * 8;
      const distance = spacing * Math.sqrt(ring);
      for (let slot = 0; slot < candidates; slot += 1) {
        const angle = (slot / candidates) * Math.PI * 2 + ring * 0.37;
        const point = {
          x: center.x + Math.cos(angle) * distance,
          y: center.y + Math.sin(angle) * distance,
        };
        if (graph.nodes.every((node) => Math.hypot(node.x - point.x, node.y - point.y) >= spacing)) return point;
      }
    }
    return { x: center.x + spacing * 2, y: center.y + spacing * 2 };
  }

  function addNodeByLabel(label) {
    const id = createUniqueId('v', graph.nodes);
    const point = nextOpenPosition(label);
    commitMutation(() => {
      graph.nodes.push({
        id,
        label,
        weight: '',
        x: point.x,
        y: point.y,
        color: '#FFFFFF',
        borderColor: '#000000',
        borderWidth: 2,
      });
      selected = null;
      pendingFrom = null;
    });
    fitGraph();
    showToast(`已添加顶点「${label}」。点击顶点可修改点权与颜色。`);
  }

  function edgeDistance(from, to) {
    return Math.round(Math.hypot(to.x - from.x, to.y - from.y));
  }

  function addEdgeByInput(from, to, weight, options) {
    const edgeId = createUniqueId('e', graph.edges);
    commitMutation(() => {
      graph.edges.push({
        id: edgeId,
        from: from.id,
        to: to.id,
        directed: options.directed,
        style: options.style,
        color: '#000000',
        weight,
        length: from.id === to.id ? 132 : Math.max(70, edgeDistance(from, to)),
      });
      selected = null;
      pendingFrom = null;
    });
    showToast(`已添加边 ${from.label || from.id} ${options.directed ? '→' : '—'} ${to.label || to.id}。`);
  }

  function handleEdgeEndpoint(id) {
    if (!pendingFrom) {
      pendingFrom = id;
      renderScene();
      return;
    }
    const from = graph.nodes.find((node) => node.id === pendingFrom);
    const to = graph.nodes.find((node) => node.id === id);
    if (!from || !to) {
      pendingFrom = null;
      renderScene();
      return;
    }
    const edgeId = createUniqueId('e', graph.edges);
    const length = from.id === to.id ? 132 : Math.max(70, edgeDistance(from, to));
    const sourceId = from.id;
    const targetId = to.id;
    commitMutation(() => {
      graph.edges.push({
        id: edgeId,
        from: sourceId,
        to: targetId,
        directed: true,
        style: 'solid',
        color: '#000000',
        weight: '',
        length,
      });
      selected = { type: 'edge', id: edgeId };
      pendingFrom = null;
    });
  }

  function syncEdgeLengths(nodeId, preserveEdgeId = null) {
    graph.edges.forEach((edge) => {
      if (edge.id === preserveEdgeId || edge.from === edge.to) return;
      if (edge.from !== nodeId && edge.to !== nodeId) return;
      const from = graph.nodes.find((node) => node.id === edge.from);
      const to = graph.nodes.find((node) => node.id === edge.to);
      if (from && to) edge.length = Math.round(Math.hypot(to.x - from.x, to.y - from.y));
    });
  }

  function deleteSelection() {
    if (!selected) return;
    const selection = clone(selected);
    commitMutation(() => {
      if (selection.type === 'node') {
        graph.nodes = graph.nodes.filter((node) => node.id !== selection.id);
        graph.edges = graph.edges.filter((edge) => edge.from !== selection.id && edge.to !== selection.id);
      } else {
        graph.edges = graph.edges.filter((edge) => edge.id !== selection.id);
      }
      selected = null;
      pendingFrom = null;
    });
  }

  function clientToView(event) {
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / VIEW_WIDTH, rect.height / VIEW_HEIGHT);
    const renderedWidth = VIEW_WIDTH * scale;
    const renderedHeight = VIEW_HEIGHT * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    return {
      x: (event.clientX - rect.left - offsetX) / scale,
      y: (event.clientY - rect.top - offsetY) / scale,
    };
  }

  function viewToWorld(point) {
    return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
  }

  function eventToWorld(event) {
    return viewToWorld(clientToView(event));
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const nodeElement = event.target.closest?.('.graph-node');
    const edgeElement = event.target.closest?.('.graph-edge');
    if (mode !== 'select') return;

    if (nodeElement) {
      const node = graph.nodes.find((item) => item.id === nodeElement.dataset.id);
      if (!node) return;
      drag = {
        kind: 'node',
        id: node.id,
        pointerId: event.pointerId,
        start: eventToWorld(event),
        original: { x: node.x, y: node.y },
        before: clone(graph),
        moved: false,
      };
      return;
    }
    if (!edgeElement) {
      drag = {
        kind: 'pan',
        pointerId: event.pointerId,
        start: clientToView(event),
        original: { x: camera.x, y: camera.y },
        moved: false,
      };
    }
  }

  function onPointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === 'node') {
      const node = graph.nodes.find((item) => item.id === drag.id);
      if (!node) return;
      const point = eventToWorld(event);
      const nextX = drag.original.x + point.x - drag.start.x;
      const nextY = drag.original.y + point.y - drag.start.y;
      if (!drag.moved && Math.hypot(nextX - drag.original.x, nextY - drag.original.y) < 2) return;
      drag.moved = true;
      selected = { type: 'node', id: node.id };
      if (!drag.captured) {
        try { svg.setPointerCapture(event.pointerId); } catch (_) { /* capture is optional in older browsers */ }
        drag.captured = true;
      }
      node.x = nextX;
      node.y = nextY;
      syncEdgeLengths(node.id);
      renderScene();
      return;
    }

    const point = clientToView(event);
    const deltaX = point.x - drag.start.x;
    const deltaY = point.y - drag.start.y;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 2) return;
    drag.moved = true;
    if (!drag.captured) {
      try { svg.setPointerCapture(event.pointerId); } catch (_) { /* capture is optional in older browsers */ }
      drag.captured = true;
    }
    camera.x = drag.original.x + deltaX;
    camera.y = drag.original.y + deltaY;
    renderScene();
  }

  function onPointerUp(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finishedDrag = drag;
    drag = null;
    try { svg.releasePointerCapture(event.pointerId); } catch (_) { /* pointer may already be released */ }
    if (finishedDrag.kind === 'node' && finishedDrag.moved) {
      if (JSON.stringify(finishedDrag.before) !== JSON.stringify(graph)) pushUndo(finishedDrag.before);
      persistGraph();
      renderInspector();
      updateHeader();
    }
    if (finishedDrag.moved) {
      suppressNextClick = true;
      window.setTimeout(() => { suppressNextClick = false; }, 140);
    }
  }

  function onCanvasClick(event) {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    const nodeElement = event.target.closest?.('.graph-node');
    const edgeElement = event.target.closest?.('.graph-edge');
    const viewPoint = clientToView(event);
    const point = viewToWorld({
      x: clamp(viewPoint.x, 0, VIEW_WIDTH),
      y: clamp(viewPoint.y, 0, VIEW_HEIGHT),
    });

    if (mode === 'node') {
      addNodeAt(point);
      return;
    }
    if (mode === 'edge') {
      if (nodeElement) {
        handleEdgeEndpoint(nodeElement.dataset.id);
      } else if (edgeElement) {
        setSelection('edge', edgeElement.dataset.id);
      } else if (pendingFrom) {
        pendingFrom = null;
        renderScene();
      }
      return;
    }
    if (nodeElement) {
      setSelection('node', nodeElement.dataset.id);
    } else if (edgeElement) {
      setSelection('edge', edgeElement.dataset.id);
    } else if (selected) {
      clearSelection();
    }
  }

  function setZoom(nextScale, anchor = { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 }) {
    const oldScale = camera.scale;
    const scale = clamp(nextScale, 0.35, 2.5);
    camera.x = anchor.x - (anchor.x - camera.x) * (scale / oldScale);
    camera.y = anchor.y - (anchor.y - camera.y) * (scale / oldScale);
    camera.scale = scale;
    renderScene();
  }

  function updateZoomLabel() {
    zoomLabelEl.textContent = `${Math.round(camera.scale * 100)}%`;
  }

  function fitGraph() {
    if (!graph.nodes.length) {
      camera = { x: 0, y: 0, scale: 1 };
      renderScene();
      return;
    }
    const radius = nodeRadius();
    const padding = Math.max(92, radius + 74);
    const minX = Math.min(...graph.nodes.map((node) => node.x)) - padding;
    const maxX = Math.max(...graph.nodes.map((node) => node.x)) + padding;
    const minY = Math.min(...graph.nodes.map((node) => node.y)) - padding - (graph.edges.some((edge) => edge.from === edge.to) ? 65 : 0);
    const maxY = Math.max(...graph.nodes.map((node) => node.y)) + padding;
    const boundsWidth = Math.max(1, maxX - minX);
    const boundsHeight = Math.max(1, maxY - minY);
    const scale = clamp(Math.min((VIEW_WIDTH - 100) / boundsWidth, (VIEW_HEIGHT - 100) / boundsHeight), 0.35, 1.55);
    camera.scale = scale;
    camera.x = (VIEW_WIDTH - (minX + maxX) * scale) / 2;
    camera.y = (VIEW_HEIGHT - (minY + maxY) * scale) / 2;
    renderScene();
  }

  function showToast(message, isError = false) {
    let toast = $('.toast-message');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast-message';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.style.display = 'block';
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.style.display = 'none';
    }, 2800);
  }

  function safeFilename(extension) {
    const base = (graph.name || 'graph').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 60) || 'graph';
    return `${base}.${extension}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJson() {
    const output = {
      format: 'graph-studio',
      version: 1,
      name: graph.name,
      nodes: graph.nodes,
      edges: graph.edges,
    };
    downloadBlob(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json;charset=utf-8' }), safeFilename('json'));
    showToast('JSON 图数据已导出。');
  }

  function exportSvgMarkup() {
    const cloneSvg = svg.cloneNode(true);
    cloneSvg.setAttribute('xmlns', SVG_NS);
    cloneSvg.setAttribute('width', '1800');
    cloneSvg.setAttribute('height', '1200');
    const background = cloneSvg.querySelector('.canvas-background');
    if (background) background.setAttribute('fill', '#fbfcfe');
    const grid = cloneSvg.querySelector('#canvas-grid');
    if (grid) grid.remove();
    cloneSvg.querySelectorAll('.node-selection-ring, .node-connect-ring, .edge-selection-halo, .edge-hit').forEach((element) => element.remove());
    const defs = cloneSvg.querySelector('defs');
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = `
      .edge-visible{fill:none;stroke-linecap:round;stroke-linejoin:round}
      .edge-label-bg{fill:#fff;stroke-width:1}
      .edge-label-text{font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-anchor:middle;dominant-baseline:central}
      .node-label,.node-weight{text-anchor:middle;font-family:Arial,sans-serif;dominant-baseline:central;pointer-events:none}
      .node-label{font-size:14px;font-weight:700}.node-weight{font-size:10.5px;font-weight:600}
    `;
    defs?.appendChild(style);
    return new XMLSerializer().serializeToString(cloneSvg);
  }

  function exportSvg() {
    const markup = exportSvgMarkup();
    downloadBlob(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }), safeFilename('svg'));
    showToast('SVG 矢量图已导出。');
  }

  async function exportPng() {
    try {
      const markup = exportSvgMarkup();
      const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 2400;
        canvas.height = 1600;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fbfcfe';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((png) => {
          if (png) {
            downloadBlob(png, safeFilename('png'));
            showToast('高清 PNG 图片已导出。');
          } else {
            showToast('无法生成 PNG 图片，请尝试导出 SVG。', true);
          }
          URL.revokeObjectURL(url);
        }, 'image/png');
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        showToast('PNG 导出失败，请尝试导出 SVG。', true);
      };
      image.src = url;
    } catch (error) {
      console.error(error);
      showToast('PNG 导出失败，请尝试导出 SVG。', true);
    }
  }

  function toggleExportMenu(force) {
    const shouldOpen = typeof force === 'boolean' ? force : exportMenu.hidden;
    exportMenu.hidden = !shouldOpen;
    $('#export-toggle').setAttribute('aria-expanded', String(shouldOpen));
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = sanitizeGraph(parsed);
      finishEdit();
      graph = imported;
      selected = null;
      pendingFrom = null;
      mode = 'select';
      undoStack = [];
      redoStack = [];
      camera = { x: 0, y: 0, scale: 1 };
      inspectorTab = 'properties';
      renderAll();
      fitGraph();
      persistGraph();
      showToast(`已导入「${graph.name}」，${graph.nodes.length} 个顶点、${graph.edges.length} 条边。`);
    } catch (error) {
      console.error(error);
      showToast(error.message || '导入失败，请检查 JSON 文件格式。', true);
    } finally {
      hiddenFileInput.value = '';
    }
  }

  function bindEvents() {
    $$('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
    $('#undo-button').addEventListener('click', undo);
    $('#redo-button').addEventListener('click', redo);
    $('#fit-button').addEventListener('click', fitGraph);
    $('#zoom-in').addEventListener('click', () => setZoom(camera.scale * 1.15));
    $('#zoom-out').addEventListener('click', () => setZoom(camera.scale / 1.15));
    $('#grid-toggle').addEventListener('click', (event) => {
      event.currentTarget.classList.toggle('is-on');
      $('#canvas-background').classList.toggle('grid-hidden', !event.currentTarget.classList.contains('is-on'));
      event.currentTarget.setAttribute('aria-pressed', String(event.currentTarget.classList.contains('is-on')));
    });
    $('#clear-selection').addEventListener('click', clearSelection);
    $('#empty-add-button').addEventListener('click', () => setMode('node'));
    $('#import-button').addEventListener('click', () => hiddenFileInput.click());
    hiddenFileInput.addEventListener('change', (event) => importFile(event.target.files?.[0]));
    $('#export-toggle').addEventListener('click', () => toggleExportMenu());
    $$('[data-export]').forEach((button) => button.addEventListener('click', async () => {
      toggleExportMenu(false);
      if (button.dataset.export === 'json') exportJson();
      if (button.dataset.export === 'svg') exportSvg();
      if (button.dataset.export === 'png') await exportPng();
    }));
    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('.export-wrap')) toggleExportMenu(false);
    });
    $$('.inspector-tab').forEach((tab) => tab.addEventListener('click', () => {
      inspectorTab = tab.dataset.tab;
      renderInspector();
    }));
    $('#help-button').addEventListener('click', () => {
      showToast('快捷键：V 选择 · N 添加顶点 · E 连边 · Ctrl/⌘ Z 撤销 · Delete 删除。');
    });

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('click', onCanvasClick);
    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const anchor = clientToView(event);
      setZoom(camera.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), anchor);
    }, { passive: false });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const editing = target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      );
      if (editing) {
        if (event.key === 'Escape') target.blur();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
      } else if (event.key === 'Escape') {
        if (pendingFrom) {
          pendingFrom = null;
          renderScene();
        } else {
          setMode('select');
        }
      } else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'v') {
        setMode('select');
      } else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'n') {
        setMode('node');
      } else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'e') {
        setMode('edge');
      }
    });
  }

  function init() {
    bindEvents();
    updateHistoryButtons();
    renderAll();
    fitGraph();
  }

  init();
})();
