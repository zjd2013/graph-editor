(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'graph-studio.graph.v1';
  const COMMAND_STORAGE_KEY = 'graph-studio.commands.v1';
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
  const MATH_UNICODE_SYMBOLS = {
    neq: '≠', ne: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥',
    times: '×', cdot: '·', pm: '±', mp: '∓', infty: '∞',
    to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ',
    lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω',
    sum: '∑', prod: '∏', int: '∫', sqrt: '√', forall: '∀', exists: '∃',
    in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
    approx: '≈', equiv: '≡',
  };
  const EDGE_TYPE_STYLES = {
    tree: { label: '树边', color: '#000000' },
    back: { label: '返祖边', color: '#EF4444' },
    forward: { label: '前向边', color: '#EAB308' },
    cross: { label: '横叉边', color: '#22C55E' },
    backward: { label: '后向边', color: '#3B82F6' },
  };
  const COMPONENT_ANNOTATIONS = {
    scc: { label: 'SCC', description: '强连通分量' },
    vbcc: { label: 'VBCC', description: '点双连通分量' },
    ebcc: { label: 'EBCC', description: '边双连通分量' },
  };

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
  const commandSidebar = $('#command-sidebar');
  const commandInput = $('#bulk-command-input');

  const measurementCanvas = document.createElement('canvas');
  const measureContext = measurementCanvas.getContext('2d');
  const mathSvgCache = new Map();

  let commandEntryCounter = 1;
  let graph = loadGraph();
  let graphAnnotation = null;
  let commandEntries = loadCommandEntries();
  commandInput.value = serializeCommandEntries(commandEntries);
  let selected = null;
  let mode = 'select';
  let pendingFrom = null;
  let inspectorTab = 'properties';
  let camera = { x: 0, y: 0, scale: 1 };
  let drag = null;
  let suppressNextClick = false;
  let activeEditBaseline = null;
  let activeEditCommandBaseline = null;
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

  function createCommandEntry(text = '', options = {}) {
    return {
      id: `command-${commandEntryCounter++}`,
      text,
      appliedText: options.appliedText || '',
      kind: options.kind || null,
      nodeIds: Array.isArray(options.nodeIds) ? [...options.nodeIds] : [],
      createdNodeIds: Array.isArray(options.createdNodeIds) ? [...options.createdNodeIds] : [],
      edgeIds: Array.isArray(options.edgeIds) ? [...options.edgeIds] : [],
    };
  }

  function commandToken(value) {
    const text = String(value ?? '');
    if (text && !/[\s"'\\]/.test(text)) return text;
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  function commandNodeToken(node, nodes = graph.nodes) {
    const label = String(node?.label || '');
    const conflicts = !label || nodes.some((other) => other.id !== node.id
      && (other.id === label || other.label === label));
    return commandToken(conflicts ? node.id : label);
  }

  function formatNodeCommand(node) {
    const label = commandToken(node.label || node.id);
    return node.weight ? `${label} ${commandToken(node.weight)}` : label;
  }

  function edgeDirectionFlagFromCommand(text, edge) {
    try {
      const tokens = tokenizeCommandLine(text);
      const flag = tokens.length === 3 ? tokens[2] : tokens.length === 4 ? tokens[3] : null;
      if (flag == null || (flag === '0') !== edge.directed) return null;
      return flag;
    } catch (_) {
      return null;
    }
  }

  function formatEdgeCommand(edge, directionFlag = null) {
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    const parts = [commandNodeToken(from || { id: edge.from }), commandNodeToken(to || { id: edge.to })];
    if (edge.weight) parts.push(commandToken(edge.weight));
    parts.push(commandToken(directionFlag ?? (edge.directed ? '0' : '1')));
    return parts.join(' ');
  }

  function createNodeCommandEntry(node, text = formatNodeCommand(node)) {
    return createCommandEntry(text, {
      appliedText: text,
      kind: 'node',
      nodeIds: [node.id],
      createdNodeIds: [node.id],
    });
  }

  function createEdgeCommandEntry(edge, createdNodeIds = [], text = formatEdgeCommand(edge)) {
    return createCommandEntry(text, {
      appliedText: text,
      kind: 'edge',
      nodeIds: [edge.from, edge.to],
      createdNodeIds,
      edgeIds: [edge.id],
    });
  }

  function loadCommandEntries() {
    try {
      const saved = localStorage.getItem(COMMAND_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          if (!parsed.length && (graph.nodes.length || graph.edges.length)) return buildCommandEntriesFromGraph(graph);
          return parsed.map((item) => {
            const text = String(item?.text ?? '');
            const entry = createCommandEntry(text, {
              appliedText: typeof item?.appliedText === 'string' ? item.appliedText : text,
              kind: ['node', 'edge'].includes(item?.kind) ? item.kind : null,
              nodeIds: Array.isArray(item?.nodeIds) ? item.nodeIds.map(String) : [],
              createdNodeIds: Array.isArray(item?.createdNodeIds) ? item.createdNodeIds.map(String) : [],
              edgeIds: Array.isArray(item?.edgeIds) ? item.edgeIds.map(String) : [],
            });
            if (typeof item?.id === 'string') {
              entry.id = item.id;
              const idMatch = entry.id.match(/(\d+)$/);
              if (idMatch) commandEntryCounter = Math.max(commandEntryCounter, Number(idMatch[1]) + 1);
            }
            const validNode = entry.nodeIds.some((id) => graph.nodes.some((node) => node.id === id));
            const validEdge = entry.edgeIds.some((id) => graph.edges.some((edge) => edge.id === id));
            if ((entry.kind === 'node' && !validNode) || (entry.kind === 'edge' && !validEdge)) entry.kind = null;
            if (entry.kind === 'edge' && entry.text === entry.appliedText) {
              const edge = graph.edges.find((item) => entry.edgeIds.includes(item.id));
              if (edge) {
                const directionFlag = edgeDirectionFlagFromCommand(entry.appliedText, edge);
                const canonicalText = formatEdgeCommand(edge, directionFlag);
                entry.text = canonicalText;
                entry.appliedText = canonicalText;
              }
            }
            if (!entry.kind) {
              entry.nodeIds = [];
              entry.createdNodeIds = [];
              entry.edgeIds = [];
              entry.appliedText = '';
            }
            return entry;
          });
        }
      }
    } catch (error) {
      console.warn('Unable to load saved graph commands:', error);
    }
    return buildCommandEntriesFromGraph(graph);
  }

  function serializeCommandEntries(entries = commandEntries) {
    return entries.map((entry) => entry.text).join('\n');
  }

  function persistCommandEntries() {
    try {
      localStorage.setItem(COMMAND_STORAGE_KEY, JSON.stringify(commandEntries));
    } catch (error) {
      console.warn('Unable to save graph commands:', error);
    }
  }

  function buildCommandEntriesFromGraph(sourceGraph) {
    const previousGraph = graph;
    graph = sourceGraph;
    const entries = [
      ...sourceGraph.nodes.map((node) => createNodeCommandEntry(node)),
      ...sourceGraph.edges.map((edge) => createEdgeCommandEntry(edge)),
    ];
    graph = previousGraph;
    return entries;
  }

  function writeCommandInput() {
    const value = serializeCommandEntries();
    if (commandInput.value === value) return;
    const wasFocused = document.activeElement === commandInput;
    const selectionStart = wasFocused ? commandInput.selectionStart : 0;
    const selectionEnd = wasFocused ? commandInput.selectionEnd : 0;
    commandInput.value = value;
    if (wasFocused) {
      const start = Math.min(selectionStart, value.length);
      const end = Math.min(selectionEnd, value.length);
      commandInput.setSelectionRange(start, end);
    }
  }

  function insertCommandEntryAtFirstEmptyLine(entry) {
    const emptyIndex = commandEntries.findIndex((line) => !line.kind && !line.text.trim());
    if (emptyIndex >= 0) commandEntries[emptyIndex] = entry;
    else commandEntries.push(entry);
  }

  function synchronizeCommandEntries(beforeGraph, afterGraph) {
    const beforeNodes = new Map(beforeGraph.nodes.map((node) => [node.id, node]));
    const beforeEdges = new Map(beforeGraph.edges.map((edge) => [edge.id, edge]));
    const afterNodes = new Map(afterGraph.nodes.map((node) => [node.id, node]));
    const afterEdges = new Map(afterGraph.edges.map((edge) => [edge.id, edge]));
    const promotedNodeIds = new Set();
    const removedEntryIds = new Set();

    commandEntries.forEach((entry) => {
      if (entry.kind === 'node' && entry.nodeIds.some((id) => !afterNodes.has(id))) {
        removedEntryIds.add(entry.id);
      }
      if (entry.kind === 'edge' && entry.edgeIds.some((id) => !afterEdges.has(id))) {
        removedEntryIds.add(entry.id);
        entry.createdNodeIds.forEach((id) => promotedNodeIds.add(id));
      }
    });
    commandEntries = commandEntries.filter((entry) => !removedEntryIds.has(entry.id));

    commandEntries.forEach((entry) => {
      entry.nodeIds = entry.nodeIds.filter((id) => afterNodes.has(id));
      entry.createdNodeIds = entry.createdNodeIds.filter((id) => afterNodes.has(id));
      entry.edgeIds = entry.edgeIds.filter((id) => afterEdges.has(id));
    });

    const hasNodeEntry = (nodeId) => commandEntries.some((entry) => entry.kind === 'node' && entry.nodeIds.includes(nodeId));
    const hasEdgeEntry = (edgeId) => commandEntries.some((entry) => entry.kind === 'edge' && entry.edgeIds.includes(edgeId));
    const hasEntryForNode = (nodeId) => commandEntries.some((entry) => entry.nodeIds.includes(nodeId));

    afterGraph.nodes.forEach((node) => {
      const previous = beforeNodes.get(node.id);
      const changedInCommand = !previous || previous.label !== node.label || previous.weight !== node.weight;
      if (!previous || changedInCommand) {
        if (!hasNodeEntry(node.id) && (!previous || !hasEntryForNode(node.id))) {
          insertCommandEntryAtFirstEmptyLine(createNodeCommandEntry(node));
        } else if (previous && !hasNodeEntry(node.id) && (previous.label !== node.label || previous.weight !== node.weight)) {
          insertCommandEntryAtFirstEmptyLine(createNodeCommandEntry(node));
        }
      }
    });

    afterGraph.edges.forEach((edge) => {
      const previous = beforeEdges.get(edge.id);
      const relevantChange = !previous || previous.from !== edge.from || previous.to !== edge.to
        || previous.directed !== edge.directed || previous.weight !== edge.weight;
      if ((!previous || relevantChange) && !hasEdgeEntry(edge.id)) {
        insertCommandEntryAtFirstEmptyLine(createEdgeCommandEntry(edge));
      }
    });

    promotedNodeIds.forEach((nodeId) => {
      if (afterNodes.has(nodeId) && !hasEntryForNode(nodeId)) {
        insertCommandEntryAtFirstEmptyLine(createNodeCommandEntry(afterNodes.get(nodeId)));
      }
    });

    const latestNodeEntryIds = new Map();
    const latestEdgeEntryIds = new Map();
    commandEntries.forEach((entry) => {
      if (entry.kind === 'node') entry.nodeIds.forEach((id) => latestNodeEntryIds.set(id, entry.id));
      if (entry.kind === 'edge') entry.edgeIds.forEach((id) => latestEdgeEntryIds.set(id, entry.id));
    });

    commandEntries.forEach((entry) => {
      const hasPendingEdit = entry.kind && entry.text !== entry.appliedText;
      if (entry.kind === 'node') {
        const node = entry.nodeIds.map((id) => afterNodes.get(id)).find(Boolean);
        if (!node || latestNodeEntryIds.get(node.id) !== entry.id) return;
        entry.nodeIds = [node.id];
        entry.createdNodeIds = [node.id];
        const canonicalText = formatNodeCommand(node);
        if (!hasPendingEdit) entry.text = canonicalText;
        entry.appliedText = canonicalText;
      } else if (entry.kind === 'edge') {
        const edge = entry.edgeIds.map((id) => afterEdges.get(id)).find(Boolean);
        if (!edge || latestEdgeEntryIds.get(edge.id) !== entry.id) return;
        entry.edgeIds = [edge.id];
        entry.nodeIds = [edge.from, edge.to];
        const sourceText = hasPendingEdit ? entry.appliedText : entry.text;
        const directionFlag = edgeDirectionFlagFromCommand(sourceText, edge);
        const canonicalText = formatEdgeCommand(edge, directionFlag);
        if (!hasPendingEdit) entry.text = canonicalText;
        entry.appliedText = canonicalText;
      }
    });

    writeCommandInput();
    persistCommandEntries();
  }

  function persistGraph() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
      persistCommandEntries();
      saveStatusEl.textContent = '本地自动保存';
      $('.status-dot').style.background = '#49b898';
    } catch (error) {
      saveStatusEl.textContent = '无法保存到本地';
      $('.status-dot').style.background = '#e5a052';
    }
  }

  function pushUndo(snapshot, commandSnapshot = commandEntries) {
    undoStack.push({ graph: clone(snapshot), commands: clone(commandSnapshot) });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function finishEdit() {
    if (!activeEditBaseline) return;
    const before = activeEditBaseline;
    const commandsBefore = activeEditCommandBaseline || clone(commandEntries);
    activeEditBaseline = null;
    activeEditCommandBaseline = null;
    if (JSON.stringify(before) !== JSON.stringify(graph)) {
      pushUndo(before, commandsBefore);
      synchronizeCommandEntries(before, graph);
    }
    persistGraph();
    updateHeader();
    updateHistoryButtons();
  }

  function beginEdit() {
    materializeGraphAnnotation();
    if (!activeEditBaseline) {
      activeEditBaseline = clone(graph);
      activeEditCommandBaseline = clone(commandEntries);
      updateHistoryButtons();
    }
  }

  function commitMutation(action, options = {}) {
    const removedAnnotation = materializeGraphAnnotation();
    finishEdit();
    const before = clone(graph);
    const commandsBefore = clone(commandEntries);
    action();
    if (JSON.stringify(before) === JSON.stringify(graph)) {
      if (removedAnnotation) renderAll();
      return;
    }
    pushUndo(before, commandsBefore);
    if (options.syncCommands !== false) synchronizeCommandEntries(before, graph);
    renderAll();
  }

  function undo() {
    if (graphAnnotation) {
      undoGraphAnnotation();
      return;
    }
    finishEdit();
    if (!undoStack.length) return;
    redoStack.push({ graph: clone(graph), commands: clone(commandEntries) });
    const snapshot = undoStack.pop();
    graph = snapshot.graph;
    commandEntries = snapshot.commands;
    selected = selected && selectionExists(selected) ? selected : null;
    pendingFrom = null;
    writeCommandInput();
    persistCommandEntries();
    updateHistoryButtons();
    renderAll();
  }

  function redo() {
    clearGraphAnnotation({ restoreCamera: true, render: true });
    finishEdit();
    if (!redoStack.length) return;
    undoStack.push({ graph: clone(graph), commands: clone(commandEntries) });
    const snapshot = redoStack.pop();
    graph = snapshot.graph;
    commandEntries = snapshot.commands;
    selected = selected && selectionExists(selected) ? selected : null;
    pendingFrom = null;
    writeCommandInput();
    persistCommandEntries();
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
    $('#undo-button').disabled = undoStack.length === 0 && !activeEditBaseline && !graphAnnotation;
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

  function splitMathText(value) {
    const text = String(value ?? '');
    const delimiter = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;
    const segments = [];
    let cursor = 0;
    let match;
    while ((match = delimiter.exec(text))) {
      if (match.index > cursor) segments.push({ type: 'text', value: text.slice(cursor, match.index) });
      segments.push({ type: 'math', value: match[1] ?? match[2] ?? match[3] ?? match[4] });
      cursor = delimiter.lastIndex;
    }
    if (cursor < text.length || !segments.length) segments.push({ type: 'text', value: text.slice(cursor) });
    return segments;
  }

  function mathFallbackText(expression) {
    return String(expression)
      .replace(/\\not\s*=/g, '≠')
      .replace(/\\left\b|\\right\b/g, '')
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
      .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\([a-zA-Z]+)\b/g, (command, name) => MATH_UNICODE_SYMBOLS[name] || name)
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function svgDimensionInPixels(value, fontSize) {
    const match = String(value || '').trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(ex|em|px|pt|pc|in|cm|mm)?$/i);
    if (!match) return 0;
    const amount = Number(match[1]);
    const unit = (match[2] || 'px').toLowerCase();
    const unitScale = {
      ex: fontSize / 2,
      em: fontSize,
      px: 1,
      pt: 96 / 72,
      pc: 16,
      in: 96,
      cm: 96 / 2.54,
      mm: 96 / 25.4,
    }[unit];
    return Number.isFinite(amount * unitScale) ? amount * unitScale : 0;
  }

  function mathSvgMetrics(expression, fontSize) {
    const mathJax = window.MathJax;
    if (!mathJax || typeof mathJax.tex2svg !== 'function') return null;
    const cacheKey = `${fontSize}\u0000${expression}`;
    if (mathSvgCache.has(cacheKey)) return mathSvgCache.get(cacheKey);

    try {
      const wrapper = mathJax.tex2svg(expression, { display: false, em: fontSize, ex: fontSize / 2 });
      const source = wrapper?.querySelector?.('svg') || (wrapper?.tagName?.toLowerCase() === 'svg' ? wrapper : null);
      if (!source) return null;
      const viewBox = (source.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      const width = svgDimensionInPixels(source.getAttribute('width'), fontSize)
        || (viewBox.length === 4 ? Math.abs(viewBox[2]) * fontSize / 1000 : 0);
      const height = svgDimensionInPixels(source.getAttribute('height'), fontSize)
        || (viewBox.length === 4 ? Math.abs(viewBox[3]) * fontSize / 1000 : 0);
      if (!width || !height) return null;

      const result = { width, height, element: source.cloneNode(true) };
      if (mathSvgCache.size >= 512) mathSvgCache.delete(mathSvgCache.keys().next().value);
      mathSvgCache.set(cacheKey, result);
      return result;
    } catch (error) {
      return null;
    }
  }

  function measureRichTextWidth(value, font, fontSize) {
    return splitMathText(value).reduce((width, segment) => {
      if (segment.type === 'text') return width + measureText(segment.value, font);
      const rendered = mathSvgMetrics(segment.value, fontSize);
      const fallback = rendered ? rendered.width : measureText(mathFallbackText(segment.value), font);
      return width + fallback;
    }, 0);
  }

  function renderRichText(value, options) {
    const {
      className,
      x = 0,
      y = 0,
      fill = '#233044',
      fontSize,
      fontWeight,
      fontFamily = 'DM Sans, Manrope, sans-serif',
    } = options;
    const text = String(value ?? '');
    const segments = splitMathText(text);
    if (!segments.some((segment) => segment.type === 'math')) {
      const output = svgElement('text', { class: className, x, y, fill, 'dominant-baseline': 'central' });
      output.textContent = text;
      return output;
    }

    const font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    const totalWidth = measureRichTextWidth(text, font, fontSize);
    const accessibleText = segments.map((segment) => (
      segment.type === 'math' ? mathFallbackText(segment.value) : segment.value
    )).join('');
    const output = svgElement('g', {
      class: className,
      fill,
      'font-family': fontFamily,
      'font-size': `${fontSize}px`,
      'font-weight': fontWeight,
      'pointer-events': 'none',
      'aria-label': accessibleText,
    });
    let cursor = -totalWidth / 2;

    const appendPlainRun = (run) => {
      if (!run) return;
      const runWidth = measureText(run, font);
      const textRun = svgElement('text', {
        x: cursor,
        y,
        fill,
        'text-anchor': 'start',
        'dominant-baseline': 'central',
      });
      textRun.textContent = run;
      output.appendChild(textRun);
      cursor += runWidth;
    };

    segments.forEach((segment) => {
      if (segment.type === 'text') {
        appendPlainRun(segment.value);
        return;
      }
      const rendered = mathSvgMetrics(segment.value, fontSize);
      if (!rendered) {
        appendPlainRun(mathFallbackText(segment.value));
        return;
      }
      const mathSvg = rendered.element.cloneNode(true);
      mathSvg.setAttribute('x', String(cursor));
      mathSvg.setAttribute('y', String(y - rendered.height / 2));
      mathSvg.setAttribute('width', String(rendered.width));
      mathSvg.setAttribute('height', String(rendered.height));
      mathSvg.setAttribute('color', fill);
      mathSvg.removeAttribute('aria-hidden');
      mathSvg.setAttribute('role', 'img');
      mathSvg.setAttribute('aria-label', mathFallbackText(segment.value));
      mathSvg.setAttribute('focusable', 'false');
      output.appendChild(mathSvg);
      cursor += rendered.width;
    });
    return output;
  }

  function nodeRadiusFor(nodes) {
    if (!nodes.length) return 31;
    let widest = 0;
    let hasSecondaryLine = false;
    nodes.forEach((node) => {
      const label = node.label || ' ';
      const weight = node.weight || '';
      widest = Math.max(widest, measureRichTextWidth(label, '700 14px DM Sans, Manrope, sans-serif', 14));
      if (weight) {
        hasSecondaryLine = true;
        widest = Math.max(widest, measureRichTextWidth(weight, '600 10.5px DM Sans, Manrope, sans-serif', 10.5));
      }
    });
    return Math.max(30, widest / 2 + 18, hasSecondaryLine ? 31 : 0);
  }

  function nodeRadius() {
    return nodeRadiusFor(graph.nodes);
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

  function displayNodePosition(node) {
    return graphAnnotation?.positions?.get(node.id) || { x: node.x, y: node.y };
  }

  function displayEdgeColor(edge) {
    return graphAnnotation?.edgeColors?.get(edge.id) || edge.color;
  }

  function edgeGeometry(edge, groupIndex, groupSize, radius) {
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    if (!from || !to) return null;

    const fromPosition = displayNodePosition(from);
    const toPosition = displayNodePosition(to);

    if (from.id === to.id) {
      const expanded = Math.max(58, edge.length * 0.57) + groupIndex * 19;
      const start = { x: fromPosition.x - radius * 0.55, y: fromPosition.y - radius * 0.82 };
      const end = { x: fromPosition.x + radius * 0.55, y: fromPosition.y - radius * 0.82 };
      const first = { x: fromPosition.x - radius - expanded * 0.42, y: fromPosition.y - radius - expanded };
      const second = { x: fromPosition.x + radius + expanded * 0.42, y: fromPosition.y - radius - expanded };
      const label = pointForCubic(start, first, second, end, 0.5);
      return {
        path: `M ${start.x} ${start.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${end.x} ${end.y}`,
        label,
        arrowTip: end,
        arrowDirection: unitVector(end.x - second.x, end.y - second.y),
      };
    }

    const dx = toPosition.x - fromPosition.x;
    const dy = toPosition.y - fromPosition.y;
    const centerDistance = Math.hypot(dx, dy) || 1;
    const canonicalSign = String(from.id).localeCompare(String(to.id)) <= 0 ? 1 : -1;
    const perpendicular = { x: (-dy / centerDistance) * canonicalSign, y: (dx / centerDistance) * canonicalSign };
    const offset = (groupIndex - (groupSize - 1) / 2) * 38;
    const control = {
      x: (fromPosition.x + toPosition.x) / 2 + perpendicular.x * offset,
      y: (fromPosition.y + toPosition.y) / 2 + perpendicular.y * offset,
    };
    const startDirection = unitVector(control.x - fromPosition.x, control.y - fromPosition.y);
    const endDirection = unitVector(toPosition.x - control.x, toPosition.y - control.y);
    const fromRadius = radius + from.borderWidth / 2 + 2;
    const toRadius = radius + to.borderWidth / 2 + 2;
    const start = { x: fromPosition.x + startDirection.x * fromRadius, y: fromPosition.y + startDirection.y * fromRadius };
    const end = { x: toPosition.x - endDirection.x * toRadius, y: toPosition.y - endDirection.y * toRadius };
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
    const edgeColor = displayEdgeColor(edge);
    const width = isSelected ? 3.1 : 2.5;

    if (isSelected) {
      group.appendChild(svgElement('path', { class: 'edge-selection-halo', d: geometry.path }));
    }
    group.appendChild(svgElement('path', { class: 'edge-hit', d: geometry.path }));
    const visible = svgElement('path', {
      class: 'edge-visible',
      d: geometry.path,
      stroke: edgeColor,
      'stroke-width': width,
      opacity: graphAnnotation?.edgeColors?.has(edge.id) ? 1 : edge.style === 'dashed' ? 0.9 : 0.86,
    });
    if (edge.style === 'dashed') visible.setAttribute('stroke-dasharray', '8 7');
    group.appendChild(visible);

    if (edge.directed) {
      group.appendChild(svgElement('polygon', {
        points: arrowPolygon(geometry.arrowTip, geometry.arrowDirection),
        fill: edgeColor,
        class: 'edge-arrow',
      }));
    }

    if (edge.weight) {
      const labelGroup = svgElement('g', {
        class: 'edge-label',
        transform: `translate(${geometry.label.x} ${geometry.label.y})`,
      });
      const textWidth = measureRichTextWidth(edge.weight, '700 12px DM Sans, Manrope, sans-serif', 12);
      const width = Math.max(31, textWidth + 17);
      labelGroup.appendChild(svgElement('rect', {
        class: 'edge-label-bg',
        x: -width / 2,
        y: -11,
        width,
        height: 22,
        rx: 7,
        stroke: edgeColor,
        'stroke-opacity': 0.26,
      }));
      labelGroup.appendChild(renderRichText(edge.weight, {
        className: 'edge-label-text',
        fill: '#3F4D63',
        fontSize: 12,
        fontWeight: 700,
      }));
      group.appendChild(labelGroup);
    }
    return group;
  }

  function renderNode(node, radius) {
    const position = displayNodePosition(node);
    const group = svgElement('g', { class: 'graph-node', 'data-id': node.id, transform: `translate(${position.x} ${position.y})` });
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
    group.appendChild(renderRichText(node.label || ' ', {
      className: 'node-label',
      y: node.weight ? -4 : 1,
      fill: textColor,
      fontSize: 14,
      fontWeight: 700,
    }));

    if (node.weight) {
      group.appendChild(renderRichText(node.weight, {
        className: 'node-weight',
        y: 13,
        fill: textColor,
        fontSize: 10.5,
        fontWeight: 600,
      }));
    }
    return group;
  }

  function renderAnnotationFrames(radius) {
    if (!graphAnnotation?.components?.length) return document.createDocumentFragment();
    const fragments = document.createDocumentFragment();
    graphAnnotation.components.forEach((component, index) => {
      const nodes = component.nodeIds.map((id) => graph.nodes.find((node) => node.id === id)).filter(Boolean);
      if (!nodes.length) return;
      const positions = nodes.map(displayNodePosition);
      const minX = Math.min(...positions.map((position) => position.x));
      const maxX = Math.max(...positions.map((position) => position.x));
      const minY = Math.min(...positions.map((position) => position.y));
      const maxY = Math.max(...positions.map((position) => position.y));
      const padX = radius + 18;
      const padTop = radius + 25;
      const padBottom = radius + 17;
      const x = minX - padX;
      const y = minY - padTop;
      const frame = svgElement('g', { class: 'annotation-frame', 'pointer-events': 'none' });
      frame.appendChild(svgElement('rect', {
        x,
        y,
        width: Math.max(1, maxX - minX + padX * 2),
        height: Math.max(1, maxY - minY + padTop + padBottom),
        rx: 18,
        fill: '#06B6D4',
        'fill-opacity': 0.035,
        stroke: '#06B6D4',
        'stroke-width': 2.5,
      }));
      const title = svgElement('text', { class: 'annotation-frame-title', x: x + 10, y: y + 16 });
      title.textContent = component.label || `${graphAnnotation.label} ${index + 1}`;
      frame.appendChild(title);
      fragments.appendChild(frame);
    });
    return fragments;
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
    fragments.appendChild(renderAnnotationFrames(radius));
    groups.forEach((edges) => edges.forEach((edge, index) => {
      const element = renderEdge(edge, index, edges.length, radius);
      if (element) fragments.appendChild(element);
    }));
    graph.nodes.forEach((node) => fragments.appendChild(renderNode(node, radius)));
    world.replaceChildren(fragments);
    world.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);
    canvasSurface.dataset.mode = mode;
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
      <div class="eyebrow-label">批量输入示例</div>
      <div class="quick-actions">
        <button class="quick-action" type="button" data-command-example="u">
          <span class="quick-action-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg></span>
          <span><strong>添加顶点</strong><small>输入 u 或 u 点权</small></span>
        </button>
        <button class="quick-action" type="button" data-command-example="u v 0">
          <span class="quick-action-icon"><svg viewBox="0 0 24 24"><circle cx="6" cy="17.5" r="3"/><circle cx="18" cy="6.5" r="3"/><path d="m8.2 15.5 7.6-7"/></svg></span>
          <span><strong>添加边</strong><small>输入 u v 0 / u v w 0</small></span>
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
      <p class="structure-intro">点击列表元素可查看和编辑属性。重边可分别设置；自环也会显示在边列表中。</p>
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
    clear.hidden = !selected;

    if (inspectorTab === 'structure') {
      heading.textContent = '图结构';
      eyebrow.textContent = 'STRUCTURE';
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

    $$('[data-command-example]', inspectorContent).forEach((button) => {
      button.addEventListener('click', () => {
        finishEdit();
        appendPendingCommandLine(button.dataset.commandExample);
        commandInput.focus();
        commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length);
      });
    });
  }

  function getSelectedObject() {
    if (!selected) return null;
    return selected.type === 'node'
      ? graph.nodes.find((node) => node.id === selected.id)
      : graph.edges.find((edge) => edge.id === selected.id);
  }

  function updateInspectorField(control) {
    beginEdit();
    const before = clone(graph);
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
    synchronizeCommandEntries(before, graph);
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
    updateAnnotationToolbar();
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

  function edgeDistance(from, to) {
    return Math.round(Math.hypot(to.x - from.x, to.y - from.y));
  }

  function tokenizeCommandLine(line) {
    const tokens = [];
    let current = '';
    let quote = null;
    let escaped = false;
    let tokenStarted = false;
    for (const character of line) {
      if (escaped) {
        current += character === '\\' || character === '"' || character === "'" || /\s/.test(character)
          ? character
          : `\\${character}`;
        escaped = false;
        tokenStarted = true;
      } else if (character === '\\') {
        escaped = true;
        tokenStarted = true;
      } else if (quote) {
        if (character === quote) quote = null;
        else current += character;
        tokenStarted = true;
      } else if (character === '"' || character === "'") {
        quote = character;
        tokenStarted = true;
      } else if (/\s/.test(character)) {
        if (tokenStarted) {
          tokens.push(current);
          current = '';
          tokenStarted = false;
        }
      } else {
        current += character;
        tokenStarted = true;
      }
    }
    if (escaped) current += '\\';
    if (quote) throw new Error('引号没有闭合');
    if (tokenStarted) tokens.push(current);
    return tokens;
  }

  function lookupNodeIn(nodes, token) {
    const byId = nodes.find((node) => node.id === token);
    if (byId) return { node: byId, ambiguous: false };
    const matches = nodes.filter((node) => node.label === token);
    if (matches.length === 1) return { node: matches[0], ambiguous: false };
    return { node: null, ambiguous: matches.length > 1 };
  }

  function ensureCommandNode(nodes, token, existing = lookupNodeIn(nodes, token)) {
    if (!token) return { node: null, ambiguous: false, created: false };
    if (existing.node || existing.ambiguous) return { ...existing, created: false };
    const point = nextCommandPosition(nodes, token, '');
    const node = {
      id: createUniqueId('v', nodes),
      label: token,
      weight: '',
      x: point.x,
      y: point.y,
      color: '#FFFFFF',
      borderColor: '#000000',
      borderWidth: 2,
    };
    nodes.push(node);
    return { node, ambiguous: false, created: true };
  }

  function nextCommandPosition(nodes, label, weight) {
    if (!nodes.length) return { x: 600, y: 400 };
    const center = {
      x: nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length,
      y: nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length,
    };
    const proposedRadius = Math.max(
      nodeRadiusFor(nodes),
      30,
      measureRichTextWidth(label, '700 14px DM Sans, Manrope, sans-serif', 14) / 2 + 18,
      weight ? measureRichTextWidth(weight, '600 10.5px DM Sans, Manrope, sans-serif', 10.5) / 2 + 18 : 0,
    );
    const spacing = Math.max(150, proposedRadius * 2 + 42);
    for (let ring = 1; ring <= 20; ring += 1) {
      const candidates = ring * 8;
      const distance = spacing * Math.sqrt(ring);
      for (let slot = 0; slot < candidates; slot += 1) {
        const angle = (slot / candidates) * Math.PI * 2 + ring * 0.37;
        const point = { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance };
        if (nodes.every((node) => Math.hypot(node.x - point.x, node.y - point.y) >= spacing)) return point;
      }
    }
    return { x: center.x + spacing * 2, y: center.y + spacing * 2 };
  }

  function findCommandLineMatches(oldEntries, newLines) {
    const oldCount = oldEntries.length;
    const newCount = newLines.length;
    if (oldCount * newCount > 2000000) {
      const matches = [];
      let prefix = 0;
      while (prefix < oldCount && prefix < newCount && oldEntries[prefix].text === newLines[prefix]) {
        matches.push([prefix, prefix]);
        prefix += 1;
      }
      let oldIndex = oldCount - 1;
      let newIndex = newCount - 1;
      const suffix = [];
      while (oldIndex >= prefix && newIndex >= prefix && oldEntries[oldIndex].text === newLines[newIndex]) {
        suffix.push([oldIndex, newIndex]);
        oldIndex -= 1;
        newIndex -= 1;
      }
      return matches.concat(suffix.reverse());
    }

    const table = Array.from({ length: oldCount + 1 }, () => new Uint32Array(newCount + 1));
    for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex -= 1) {
      for (let newIndex = newCount - 1; newIndex >= 0; newIndex -= 1) {
        table[oldIndex][newIndex] = oldEntries[oldIndex].text === newLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
      }
    }

    const matches = [];
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldCount && newIndex < newCount) {
      if (oldEntries[oldIndex].text === newLines[newIndex]) {
        matches.push([oldIndex, newIndex]);
        oldIndex += 1;
        newIndex += 1;
      } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
        oldIndex += 1;
      } else {
        newIndex += 1;
      }
    }
    return matches;
  }

  function removeCommandEntriesFromGraph(removedEntries, candidateEntries) {
    const removedEntryIds = new Set(removedEntries.map((entry) => entry.id));
    const deletedNodeIds = new Set();
    const deletedEdgeIds = new Set();
    const possibleOrphanIds = new Set();

    removedEntries.forEach((entry) => {
      if (entry.kind === 'node') {
        entry.nodeIds.forEach((id) => {
          const hasOtherNodeLine = candidateEntries.some((candidate) => !removedEntryIds.has(candidate.id)
            && candidate.kind === 'node' && candidate.nodeIds.includes(id));
          if (!hasOtherNodeLine) deletedNodeIds.add(id);
        });
      }
      if (entry.kind === 'edge') {
        entry.edgeIds.forEach((id) => deletedEdgeIds.add(id));
        entry.createdNodeIds.forEach((id) => possibleOrphanIds.add(id));
      }
    });

    let changed = true;
    while (changed) {
      const previousCounts = `${removedEntryIds.size}:${deletedNodeIds.size}:${deletedEdgeIds.size}`;
      graph.edges.forEach((edge) => {
        if (deletedNodeIds.has(edge.from) || deletedNodeIds.has(edge.to)) deletedEdgeIds.add(edge.id);
      });
      candidateEntries.forEach((entry) => {
        if (entry.kind === 'node' && entry.nodeIds.some((id) => deletedNodeIds.has(id))) {
          removedEntryIds.add(entry.id);
        }
        if (entry.kind === 'edge' && entry.edgeIds.some((id) => deletedEdgeIds.has(id))) {
          removedEntryIds.add(entry.id);
          entry.createdNodeIds.forEach((id) => possibleOrphanIds.add(id));
        }
      });

      possibleOrphanIds.forEach((nodeId) => {
        if (!graph.nodes.some((node) => node.id === nodeId)) return;
        const hasRemainingEdge = graph.edges.some((edge) => !deletedEdgeIds.has(edge.id)
          && (edge.from === nodeId || edge.to === nodeId));
        const hasRemainingLine = candidateEntries.some((entry) => !removedEntryIds.has(entry.id)
          && entry.nodeIds.includes(nodeId));
        if (!hasRemainingEdge && !hasRemainingLine) deletedNodeIds.add(nodeId);
      });
      changed = previousCounts !== `${removedEntryIds.size}:${deletedNodeIds.size}:${deletedEdgeIds.size}`;
    }

    const nextEntries = candidateEntries.filter((entry) => !removedEntryIds.has(entry.id));
    const draft = clone(graph);
    draft.edges = draft.edges.filter((edge) => !deletedEdgeIds.has(edge.id)
      && !deletedNodeIds.has(edge.from) && !deletedNodeIds.has(edge.to));
    draft.nodes = draft.nodes.filter((node) => !deletedNodeIds.has(node.id));

    if (JSON.stringify(draft) !== JSON.stringify(graph)) {
      commitMutation(() => {
        graph = draft;
        if (selected && !selectionExists(selected)) selected = null;
        if (pendingFrom && deletedNodeIds.has(pendingFrom)) pendingFrom = null;
      }, { syncCommands: false });
    }
    possibleOrphanIds.forEach((nodeId) => {
      if (deletedNodeIds.has(nodeId) || !draft.nodes.some((node) => node.id === nodeId)) return;
      const hasNodeLine = nextEntries.some((entry) => entry.kind === 'node' && entry.nodeIds.includes(nodeId));
      const owner = nextEntries.find((entry) => entry.kind === 'edge' && entry.nodeIds.includes(nodeId));
      if (!hasNodeLine && owner && !owner.createdNodeIds.includes(nodeId)) owner.createdNodeIds.push(nodeId);
    });
    return nextEntries;
  }

  function reconcileCommandInput() {
    if (!commandEntries.length && !commandInput.value) return;
    const newLines = commandInput.value.split(/\r?\n/);
    const oldEntries = commandEntries;
    const matches = findCommandLineMatches(oldEntries, newLines);
    const nextEntries = new Array(newLines.length);
    const removedEntries = [];

    function reconcileGap(oldStart, oldEnd, newStart, newEnd) {
      const pairCount = Math.min(oldEnd - oldStart, newEnd - newStart);
      for (let offset = 0; offset < pairCount; offset += 1) {
        const original = oldEntries[oldStart + offset];
        const entry = clone(original);
        const text = newLines[newStart + offset];
        if (entry.kind && !text.trim()) {
          removedEntries.push(original);
          nextEntries[newStart + offset] = createCommandEntry(text);
        } else {
          entry.text = text;
          nextEntries[newStart + offset] = entry;
        }
      }
      for (let oldIndex = oldStart + pairCount; oldIndex < oldEnd; oldIndex += 1) {
        removedEntries.push(oldEntries[oldIndex]);
      }
      for (let newIndex = newStart + pairCount; newIndex < newEnd; newIndex += 1) {
        nextEntries[newIndex] = createCommandEntry(newLines[newIndex]);
      }
    }

    let oldCursor = 0;
    let newCursor = 0;
    [...matches, [oldEntries.length, newLines.length]].forEach(([oldIndex, newIndex]) => {
      reconcileGap(oldCursor, oldIndex, newCursor, newIndex);
      if (oldIndex < oldEntries.length) {
        const entry = clone(oldEntries[oldIndex]);
        entry.text = newLines[newIndex];
        nextEntries[newIndex] = entry;
        oldCursor = oldIndex + 1;
        newCursor = newIndex + 1;
      }
    });

    commandEntries = removeCommandEntriesFromGraph(removedEntries, nextEntries);
    writeCommandInput();
    persistCommandEntries();
  }

  function appendPendingCommandLine(text) {
    reconcileCommandInput();
    insertCommandEntryAtFirstEmptyLine(createCommandEntry(text));
    writeCommandInput();
    persistCommandEntries();
  }

  function commandLineIndexAt(offset) {
    const position = Math.max(0, Math.min(Number(offset) || 0, commandInput.value.length));
    return (commandInput.value.slice(0, position).match(/\n/g) || []).length;
  }

  function pendingCommandIdsThrough(lineIndex) {
    return commandEntries.slice(0, lineIndex + 1)
      .filter((entry) => entry.text.trim() && (!entry.kind || entry.text !== entry.appliedText))
      .map((entry) => entry.id);
  }

  function commandEntryIsComplete(entry) {
    try {
      const count = tokenizeCommandLine(entry.text).length;
      if (entry.kind === 'node') return count >= 1 && count <= 4;
      if (entry.kind === 'edge') return count >= 3 && count <= 4;
      return count >= 1 && count <= 4;
    } catch (_) {
      return false;
    }
  }

  function commandEntryCanAutoApply(entry, { allowTrailingWhitespace = false } = {}) {
    if (!commandEntryIsComplete(entry)) return false;
    if (!allowTrailingWhitespace && /\s$/.test(entry.text)) return false;
    try {
      const tokens = tokenizeCommandLine(entry.text);
      if (!tokens.length || !tokens[0]) return false;
      if (tokens.length >= 3 && !tokens[1]) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function applyPendingCommandEntries(options = {}) {
    const entryIds = commandEntries.filter((entry) => entry.text.trim()
      && (!entry.kind || entry.text !== entry.appliedText)
      && commandEntryCanAutoApply(entry, options))
      .map((entry) => entry.id);
    if (!entryIds.length) return false;
    return applyBulkInput(entryIds);
  }

  function handleCommandInput(event) {
    reconcileCommandInput();
    if (!event.isComposing) applyPendingCommandEntries();
  }

  function flushCommandInputApply() {
    reconcileCommandInput();
    applyPendingCommandEntries({ allowTrailingWhitespace: true });
  }

  function applyBulkInput(entryIds = null) {
    reconcileCommandInput();
    const targetIds = entryIds ? new Set(entryIds) : null;
    const draft = clone(graph);
    const nextEntries = clone(commandEntries);
    const errors = [];
    const orphanCandidates = new Set();
    let addedNodes = 0;
    let addedEdges = 0;
    let updatedNodes = 0;
    let updatedCommands = 0;

    nextEntries.forEach((entry, index) => {
      if (targetIds && !targetIds.has(entry.id)) return;
      if (!entry.text.trim()) return;
      const currentNode = entry.kind === 'node'
        ? draft.nodes.find((node) => entry.nodeIds.includes(node.id))
        : null;
      const currentEdge = entry.kind === 'edge'
        ? draft.edges.find((edge) => entry.edgeIds.includes(edge.id))
        : null;
      if (entry.kind && !currentNode && !currentEdge) {
        entry.kind = null;
        entry.nodeIds = [];
        entry.createdNodeIds = [];
        entry.edgeIds = [];
        entry.appliedText = '';
      }
      const isApplied = Boolean(currentNode || currentEdge);
      if (isApplied && entry.text === entry.appliedText) return;

      let tokens;
      try {
        tokens = tokenizeCommandLine(entry.text);
      } catch (error) {
        errors.push(`第 ${index + 1} 行：${error.message}`);
        return;
      }
      if (tokens.length < 1 || tokens.length > 4) {
        errors.push(`第 ${index + 1} 行：每行需要 1–4 个字符串`);
        return;
      }

      if (tokens.length <= 2) {
        const label = tokens[0];
        const weight = tokens.length === 2 ? tokens[1] : '';
        if (!label) {
          errors.push(`第 ${index + 1} 行：顶点标签不能为空`);
          return;
        }
        if (entry.kind === 'edge' && currentEdge) {
          errors.push(`第 ${index + 1} 行：不能把已绑定的边命令改成顶点命令`);
          return;
        }
        if (currentNode) {
          currentNode.label = label;
          currentNode.weight = weight;
          updatedNodes += 1;
          entry.kind = 'node';
          entry.nodeIds = [currentNode.id];
          entry.createdNodeIds = [currentNode.id];
          entry.edgeIds = [];
        } else {
          const duplicate = draft.nodes.find((node) => node.id === label)
            || draft.nodes.find((node) => node.label === label);
          if (duplicate) {
            if (tokens.length === 2) {
              duplicate.weight = weight;
              updatedNodes += 1;
            }
            entry.kind = 'node';
            entry.nodeIds = [duplicate.id];
            entry.createdNodeIds = [duplicate.id];
            entry.edgeIds = [];
            entry.appliedText = entry.text;
            updatedCommands += 1;
            return;
          }
          const id = createUniqueId('v', draft.nodes);
          const point = nextCommandPosition(draft.nodes, label, weight);
          const node = {
            id,
            label,
            weight,
            x: point.x,
            y: point.y,
            color: '#FFFFFF',
            borderColor: '#000000',
            borderWidth: 2,
          };
          draft.nodes.push(node);
          entry.kind = 'node';
          entry.nodeIds = [id];
          entry.createdNodeIds = [id];
          entry.edgeIds = [];
          addedNodes += 1;
        }
        entry.appliedText = entry.text;
        updatedCommands += 1;
        return;
      }

      if (entry.kind === 'node' && currentNode) {
        entry.createdNodeIds.forEach((id) => orphanCandidates.add(id));
      }

      const fromLookup = lookupNodeIn(draft.nodes, tokens[0]);
      const toLookup = lookupNodeIn(draft.nodes, tokens[1]);
      const fromResult = ensureCommandNode(draft.nodes, tokens[0], fromLookup);
      const toResult = tokens[0] === tokens[1]
        ? fromResult
        : ensureCommandNode(draft.nodes, tokens[1], toLookup);
      if (fromResult.created) addedNodes += 1;
      if (toResult.created && tokens[0] !== tokens[1]) addedNodes += 1;
      if (!fromResult.node || !toResult.node) {
        const token = !fromResult.node ? tokens[0] : tokens[1];
        const result = !fromResult.node ? fromResult : toResult;
        errors.push(result.ambiguous
          ? `第 ${index + 1} 行：「${token}」标签重复，请使用顶点 ID`
          : `第 ${index + 1} 行：顶点名不能为空`);
        return;
      }

      if (entry.kind === 'node' && currentNode
        && (fromResult.node.id === currentNode.id || toResult.node.id === currentNode.id)
        && currentNode.weight) {
        currentNode.weight = '';
        updatedNodes += 1;
      }

      const directionFlag = tokens.length === 3 ? tokens[2] : tokens[3];
      const directed = directionFlag === '0';
      const weight = tokens.length === 4 ? tokens[2] : '';
      const createdNodeIds = [...new Set([fromResult, toResult]
        .filter((result) => result.created)
        .map((result) => result.node.id))];

      if (currentEdge) {
        entry.createdNodeIds.forEach((id) => orphanCandidates.add(id));
        currentEdge.from = fromResult.node.id;
        currentEdge.to = toResult.node.id;
        currentEdge.directed = directed;
        currentEdge.weight = weight;
        currentEdge.length = currentEdge.from === currentEdge.to ? Math.max(132, currentEdge.length) : edgeDistance(fromResult.node, toResult.node);
        entry.kind = 'edge';
        entry.edgeIds = [currentEdge.id];
        entry.nodeIds = [currentEdge.from, currentEdge.to];
        entry.createdNodeIds = createdNodeIds;
      } else {
        const edge = {
          id: createUniqueId('e', draft.edges),
          from: fromResult.node.id,
          to: toResult.node.id,
          directed,
          style: 'solid',
          color: '#000000',
          weight,
          length: fromResult.node.id === toResult.node.id ? 132 : Math.max(70, edgeDistance(fromResult.node, toResult.node)),
        };
        draft.edges.push(edge);
        entry.kind = 'edge';
        entry.edgeIds = [edge.id];
        entry.nodeIds = [edge.from, edge.to];
        entry.createdNodeIds = createdNodeIds;
        addedEdges += 1;
      }
      entry.appliedText = entry.text;
      updatedCommands += 1;
    });

    if (errors.length) {
      const detail = errors.slice(0, 2).join('；');
      const remainder = errors.length > 2 ? `（另有 ${errors.length - 2} 个错误）` : '';
      showToast(`${detail}${remainder}`, true);
      return false;
    }
    if (!updatedCommands) {
      showToast('所有命令都已应用；修改或删除命令行即可同步更新图。');
      return false;
    }

    orphanCandidates.forEach((nodeId) => {
      const hasNodeLine = nextEntries.some((entry) => entry.kind === 'node' && entry.nodeIds.includes(nodeId));
      const owner = nextEntries.find((entry) => entry.kind === 'edge' && entry.nodeIds.includes(nodeId));
      const connected = draft.edges.some((edge) => edge.from === nodeId || edge.to === nodeId);
      if (hasNodeLine) return;
      if (owner) {
        if (!owner.createdNodeIds.includes(nodeId)) owner.createdNodeIds.push(nodeId);
      } else if (connected) {
        const node = draft.nodes.find((item) => item.id === nodeId);
        if (node) nextEntries.push(createNodeCommandEntry(node));
      } else {
        draft.nodes = draft.nodes.filter((node) => node.id !== nodeId);
      }
    });

    const graphChanged = JSON.stringify(draft) !== JSON.stringify(graph);
    if (graphChanged) {
      commitMutation(() => {
        graph = draft;
        if (selected && !selectionExists(selected)) selected = null;
        pendingFrom = null;
      }, { syncCommands: false });
    }
    commandEntries = nextEntries;
    writeCommandInput();
    persistCommandEntries();
    if (addedNodes || updatedNodes) fitGraph();
    showToast(addedNodes || addedEdges
      ? `已应用 ${updatedCommands} 行命令，新增 ${addedNodes} 个顶点、${addedEdges} 条边。`
      : `已更新 ${updatedCommands} 行命令。`);
    return true;
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
        original: displayNodePosition(node),
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
      materializeGraphAnnotation();
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
    const positions = graph.nodes.map(displayNodePosition);
    const minX = Math.min(...positions.map((position) => position.x)) - padding;
    const maxX = Math.max(...positions.map((position) => position.x)) + padding;
    const minY = Math.min(...positions.map((position) => position.y)) - padding - (graph.edges.some((edge) => edge.from === edge.to) ? 65 : 0);
    const maxY = Math.max(...positions.map((position) => position.y)) + padding;
    const boundsWidth = Math.max(1, maxX - minX);
    const boundsHeight = Math.max(1, maxY - minY);
    const scale = clamp(Math.min((VIEW_WIDTH - 100) / boundsWidth, (VIEW_HEIGHT - 100) / boundsHeight), 0.35, 1.55);
    camera.scale = scale;
    camera.x = (VIEW_WIDTH - (minX + maxX) * scale) / 2;
    camera.y = (VIEW_HEIGHT - (minY + maxY) * scale) / 2;
    renderScene();
  }

  function makeUnderlyingAdjacency(ignoreDirection = false) {
    const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
    graph.edges.forEach((edge) => {
      if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) return;
      adjacency.get(edge.from).push({ edge, to: edge.to });
      if ((ignoreDirection || !edge.directed) && edge.from !== edge.to) adjacency.get(edge.to).push({ edge, to: edge.from });
    });
    return adjacency;
  }

  function sortComponents(components) {
    const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
    return components
      .map((component) => [...new Set(component)].sort((a, b) => nodeOrder.get(a) - nodeOrder.get(b)))
      .filter((component) => component.length)
      .sort((a, b) => nodeOrder.get(a[0]) - nodeOrder.get(b[0]));
  }

  function findStronglyConnectedComponents() {
    const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
    const incoming = new Map(graph.nodes.map((node) => [node.id, []]));
    const addArc = (from, to) => {
      if (!outgoing.has(from) || !outgoing.has(to)) return;
      outgoing.get(from).push(to);
      incoming.get(to).push(from);
    };
    graph.edges.forEach((edge) => {
      addArc(edge.from, edge.to);
      if (!edge.directed && edge.from !== edge.to) addArc(edge.to, edge.from);
    });

    const visited = new Set();
    const finishOrder = [];
    graph.nodes.forEach((node) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      const stack = [{ id: node.id, next: 0 }];
      while (stack.length) {
        const top = stack[stack.length - 1];
        const neighbors = outgoing.get(top.id) || [];
        if (top.next < neighbors.length) {
          const neighbor = neighbors[top.next];
          top.next += 1;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            stack.push({ id: neighbor, next: 0 });
          }
        } else {
          finishOrder.push(top.id);
          stack.pop();
        }
      }
    });

    const assigned = new Set();
    const components = [];
    finishOrder.reverse().forEach((root) => {
      if (assigned.has(root)) return;
      const component = [];
      const stack = [root];
      assigned.add(root);
      while (stack.length) {
        const current = stack.pop();
        component.push(current);
        (incoming.get(current) || []).forEach((neighbor) => {
          if (assigned.has(neighbor)) return;
          assigned.add(neighbor);
          stack.push(neighbor);
        });
      }
      components.push(component);
    });
    return sortComponents(components);
  }

  function findVertexBiconnectedComponents() {
    const adjacency = makeUnderlyingAdjacency(true);
    const discovery = new Map();
    const low = new Map();
    const edgeStack = [];
    const components = [];
    let time = 0;

    function popComponent(stopEdgeId) {
      const componentNodes = new Set();
      let edge;
      do {
        edge = edgeStack.pop();
        if (!edge) break;
        componentNodes.add(edge.from);
        componentNodes.add(edge.to);
      } while (edge.id !== stopEdgeId);
      if (componentNodes.size) components.push([...componentNodes]);
    }

    function visit(nodeId, parentEdgeId) {
      time += 1;
      discovery.set(nodeId, time);
      low.set(nodeId, time);
      (adjacency.get(nodeId) || []).forEach((arc) => {
        const edge = arc.edge;
        if (edge.from === edge.to || edge.id === parentEdgeId) return;
        if (!discovery.has(arc.to)) {
          edgeStack.push(edge);
          visit(arc.to, edge.id);
          low.set(nodeId, Math.min(low.get(nodeId), low.get(arc.to)));
          if (low.get(arc.to) >= discovery.get(nodeId)) popComponent(edge.id);
        } else if (discovery.get(arc.to) < discovery.get(nodeId)) {
          edgeStack.push(edge);
          low.set(nodeId, Math.min(low.get(nodeId), discovery.get(arc.to)));
        }
      });
    }

    graph.nodes.forEach((node) => {
      if (discovery.has(node.id)) return;
      visit(node.id, null);
      if (edgeStack.length) popComponent(null);
    });
    const included = new Set(components.flat());
    graph.nodes.forEach((node) => {
      if (!included.has(node.id)) components.push([node.id]);
    });
    return sortComponents(components);
  }

  function findEdgeBiconnectedComponents() {
    const adjacency = makeUnderlyingAdjacency(true);
    const discovery = new Map();
    const low = new Map();
    const bridges = new Set();
    let time = 0;

    function visit(nodeId, parentEdgeId) {
      time += 1;
      discovery.set(nodeId, time);
      low.set(nodeId, time);
      (adjacency.get(nodeId) || []).forEach((arc) => {
        const edge = arc.edge;
        if (edge.from === edge.to || edge.id === parentEdgeId) return;
        if (!discovery.has(arc.to)) {
          visit(arc.to, edge.id);
          low.set(nodeId, Math.min(low.get(nodeId), low.get(arc.to)));
          if (low.get(arc.to) > discovery.get(nodeId)) bridges.add(edge.id);
        } else {
          low.set(nodeId, Math.min(low.get(nodeId), discovery.get(arc.to)));
        }
      });
    }

    graph.nodes.forEach((node) => {
      if (!discovery.has(node.id)) visit(node.id, null);
    });

    const visited = new Set();
    const components = [];
    graph.nodes.forEach((node) => {
      if (visited.has(node.id)) return;
      const component = [];
      const stack = [node.id];
      visited.add(node.id);
      while (stack.length) {
        const current = stack.pop();
        component.push(current);
        (adjacency.get(current) || []).forEach((arc) => {
          if (bridges.has(arc.edge.id) || visited.has(arc.to)) return;
          visited.add(arc.to);
          stack.push(arc.to);
        });
      }
      components.push(component);
    });
    return sortComponents(components);
  }

  function classifyTreeEdges() {
    const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
    graph.edges.forEach((edge) => {
      if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) return;
      adjacency.get(edge.from).push({ edge, to: edge.to });
      if (!edge.directed && edge.from !== edge.to) adjacency.get(edge.to).push({ edge, to: edge.from });
    });

    const discovery = new Map();
    const finish = new Map();
    const treeEdges = new Set();
    let time = 0;
    function visit(nodeId, parentEdgeId) {
      time += 1;
      discovery.set(nodeId, time);
      (adjacency.get(nodeId) || []).forEach((arc) => {
        if (!arc.edge.directed && arc.edge.id === parentEdgeId) return;
        if (discovery.has(arc.to)) return;
        treeEdges.add(arc.edge.id);
        visit(arc.to, arc.edge.id);
      });
      time += 1;
      finish.set(nodeId, time);
    }
    graph.nodes.forEach((node) => {
      if (!discovery.has(node.id)) visit(node.id, null);
    });

    const isAncestor = (ancestorId, nodeId) => ancestorId !== nodeId
      && discovery.get(ancestorId) < discovery.get(nodeId)
      && finish.get(ancestorId) > finish.get(nodeId);
    const edgeTypes = new Map();
    graph.edges.forEach((edge) => {
      let type;
      if (treeEdges.has(edge.id)) type = 'tree';
      else if (!edge.directed) type = 'back';
      else if (edge.from === edge.to || isAncestor(edge.to, edge.from)) type = 'back';
      else if (isAncestor(edge.from, edge.to)) type = 'forward';
      else if (discovery.get(edge.from) < discovery.get(edge.to)) type = 'cross';
      else type = 'backward';
      edgeTypes.set(edge.id, type);
    });
    return new Map([...edgeTypes].map(([edgeId, type]) => [edgeId, EDGE_TYPE_STYLES[type].color]));
  }

  function makeComponentLayoutGroups(type, components) {
    if (type !== 'vbcc') return components.map((nodeIds) => ({ nodeIds: [...nodeIds] }));
    const parents = components.map((_, index) => index);
    const find = (index) => {
      if (parents[index] !== index) parents[index] = find(parents[index]);
      return parents[index];
    };
    const union = (left, right) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    };
    const ownerByNode = new Map();
    components.forEach((component, index) => component.forEach((nodeId) => {
      if (ownerByNode.has(nodeId)) union(index, ownerByNode.get(nodeId));
      else ownerByNode.set(nodeId, index);
    }));
    const groups = new Map();
    components.forEach((component, index) => {
      const root = find(index);
      if (!groups.has(root)) groups.set(root, new Set());
      component.forEach((nodeId) => groups.get(root).add(nodeId));
    });
    return [...groups.values()].map((nodeIds) => ({ nodeIds: [...nodeIds] }));
  }

  function layoutComponentPositions(type, components) {
    const positions = new Map();
    const layoutGroups = makeComponentLayoutGroups(type, components);
    if (!layoutGroups.length) return positions;
    const radius = nodeRadius();
    const spacing = Math.max(112, radius * 2 + 54);
    const groupGap = Math.max(110, radius * 2 + 76);
    const maxRowWidth = Math.max(900, VIEW_WIDTH - 150);
    const placements = [];
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;

    layoutGroups.forEach((group) => {
      const columns = Math.max(1, Math.ceil(Math.sqrt(group.nodeIds.length)));
      const rows = Math.max(1, Math.ceil(group.nodeIds.length / columns));
      const width = columns * spacing;
      const height = rows * spacing;
      if (cursorX > 0 && cursorX + width > maxRowWidth) {
        cursorX = 0;
        cursorY += rowHeight + groupGap;
        rowHeight = 0;
      }
      placements.push({ ...group, x: cursorX, y: cursorY, width, height, columns, rows });
      cursorX += width + groupGap;
      rowHeight = Math.max(rowHeight, height);
    });

    const totalWidth = Math.max(...placements.map((placement) => placement.x + placement.width));
    const totalHeight = Math.max(...placements.map((placement) => placement.y + placement.height));
    const shiftX = VIEW_WIDTH / 2 - totalWidth / 2;
    const shiftY = VIEW_HEIGHT / 2 - totalHeight / 2;
    const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const membershipCounts = new Map();
    components.forEach((component) => component.forEach((nodeId) => {
      membershipCounts.set(nodeId, (membershipCounts.get(nodeId) || 0) + 1);
    }));

    placements.forEach((placement) => {
      let orderedNodeIds = [...placement.nodeIds].sort((a, b) => {
        if (type === 'vbcc') {
          const membershipDifference = (membershipCounts.get(b) || 0) - (membershipCounts.get(a) || 0);
          if (membershipDifference) return membershipDifference;
        }
        return nodeOrder.get(a) - nodeOrder.get(b);
      });
      if (type === 'vbcc') {
        const slots = orderedNodeIds.map((_, index) => ({
          row: Math.floor(index / placement.columns),
          column: index % placement.columns,
        })).sort((a, b) => {
          const centerColumn = (placement.columns - 1) / 2;
          const centerRow = (placement.rows - 1) / 2;
          const distanceA = (a.column - centerColumn) ** 2 + (a.row - centerRow) ** 2;
          const distanceB = (b.column - centerColumn) ** 2 + (b.row - centerRow) ** 2;
          return distanceA - distanceB || a.row - b.row || a.column - b.column;
        });
        orderedNodeIds.forEach((nodeId, index) => {
          const slot = slots[index];
          positions.set(nodeId, {
            x: shiftX + placement.x + (slot.column + 0.5) * spacing,
            y: shiftY + placement.y + (slot.row + 0.5) * spacing,
          });
        });
      } else {
        orderedNodeIds.forEach((nodeId, index) => {
          const row = Math.floor(index / placement.columns);
          const column = index % placement.columns;
          positions.set(nodeId, {
            x: shiftX + placement.x + (column + 0.5) * spacing,
            y: shiftY + placement.y + (row + 0.5) * spacing,
          });
        });
      }
    });
    return positions;
  }

  function updateAnnotationToolbar() {
    const buttons = [
      ['edge-types', '#mark-edge-types-button'],
      ['scc', '#mark-scc-button'],
      ['vbcc', '#mark-vbcc-button'],
      ['ebcc', '#mark-ebcc-button'],
    ];
    buttons.forEach(([type, selector]) => {
      const button = $(selector);
      if (!button) return;
      const active = graphAnnotation?.type === type;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = type === 'edge-types' ? graph.edges.length === 0 : graph.nodes.length === 0;
    });
    $('#analysis-toolbar-toggle')?.classList.toggle('is-on', Boolean(graphAnnotation));
    const undoButton = $('#undo-annotation-button');
    if (undoButton) undoButton.disabled = !graphAnnotation;
    const legend = $('#analysis-legend');
    if (!legend) return;
    if (!graphAnnotation) {
      legend.textContent = '新标注会替换当前标注；SCC 按边方向计算，VBCC / EBCC 按忽略方向的无向图计算。';
      return;
    }
    if (graphAnnotation.type === 'edge-types') {
      const swatches = Object.values(EDGE_TYPE_STYLES).map((style) => (
        `<span class="analysis-legend-item"><i class="analysis-legend-swatch" style="background:${style.color}"></i>${style.label}</span>`
      )).join('');
      legend.innerHTML = `${swatches}<small class="analysis-legend-note">蓝色后向边表示从 DFS 顺序较晚的顶点指向较早的非祖先顶点。</small>`;
      return;
    }
    const metadata = COMPONENT_ANNOTATIONS[graphAnnotation.type];
    legend.textContent = `${metadata.label}（${metadata.description}）：${graphAnnotation.components.length} 个青色框；布局仅影响显示，可撤销恢复。`;
  }

  function clearGraphAnnotation({ restoreCamera = true, render = false } = {}) {
    if (!graphAnnotation) return false;
    const originalCamera = graphAnnotation.originalCamera;
    graphAnnotation = null;
    if (restoreCamera) camera = { ...originalCamera };
    updateAnnotationToolbar();
    updateHistoryButtons();
    if (render) renderScene();
    return true;
  }

  function materializeGraphAnnotation() {
    if (!graphAnnotation) return false;
    graph.nodes.forEach((node) => {
      const position = graphAnnotation.positions?.get(node.id);
      if (!position) return;
      node.x = position.x;
      node.y = position.y;
    });
    graph.edges.forEach((edge) => {
      if (edge.from === edge.to) return;
      const from = graph.nodes.find((node) => node.id === edge.from);
      const to = graph.nodes.find((node) => node.id === edge.to);
      if (from && to) edge.length = Math.round(Math.hypot(to.x - from.x, to.y - from.y));
    });
    graphAnnotation = null;
    updateAnnotationToolbar();
    updateHistoryButtons();
    return true;
  }

  function undoGraphAnnotation() {
    if (!clearGraphAnnotation({ restoreCamera: true, render: true })) return;
    showToast('已撤销标注，恢复标注前的视图。');
  }

  function applyGraphAnnotation(type) {
    finishEdit();
    if (!graph.nodes.length) {
      showToast('没有顶点可进行图分析。', true);
      return;
    }
    if (type === 'edge-types' && !graph.edges.length) {
      showToast('没有边可标注生成树边类型。', true);
      return;
    }
    const originalCamera = graphAnnotation?.originalCamera || { ...camera };
    graphAnnotation = null;
    camera = { ...originalCamera };

    if (type === 'edge-types') {
      const edgeColors = classifyTreeEdges();
      graphAnnotation = { type, label: '生成树边类型', edgeColors, components: [], positions: new Map(), originalCamera };
      updateAnnotationToolbar();
      renderScene();
      updateHistoryButtons();
      showToast(`已标注 ${edgeColors.size} 条生成树边类型。`);
      return;
    }

    const metadata = COMPONENT_ANNOTATIONS[type];
    if (!metadata) return;
    const nodeComponents = type === 'scc'
      ? findStronglyConnectedComponents()
      : type === 'vbcc'
        ? findVertexBiconnectedComponents()
        : findEdgeBiconnectedComponents();
    const components = nodeComponents.map((nodeIds, index) => ({
      nodeIds,
      label: `${metadata.label} ${index + 1}`,
    }));
    graphAnnotation = {
      type,
      label: metadata.label,
      edgeColors: new Map(),
      components,
      positions: layoutComponentPositions(type, nodeComponents),
      originalCamera,
    };
    updateAnnotationToolbar();
    fitGraph();
    updateHistoryButtons();
    showToast(`已标注 ${metadata.description}：${components.length} 个青色框。`);
  }

  function arrangeAsTree() {
    if (!graph.nodes.length) {
      showToast('没有顶点可整理。', true);
      return;
    }

    const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const adjacency = new Map(graph.nodes.map((node) => [node.id, new Set()]));
    graph.edges.forEach((edge) => {
      if (edge.from === edge.to || !adjacency.has(edge.from) || !adjacency.has(edge.to)) return;
      adjacency.get(edge.from).add(edge.to);
      adjacency.get(edge.to).add(edge.from);
    });

    const roots = [];
    const children = new Map(graph.nodes.map((node) => [node.id, []]));
    const visited = new Set();
    const preferredRoot = selected?.type === 'node' && adjacency.has(selected.id) ? selected.id : graph.nodes[0].id;
    const candidates = [preferredRoot, ...graph.nodes.map((node) => node.id)];

    candidates.forEach((root) => {
      if (visited.has(root)) return;
      roots.push(root);
      visited.add(root);
      const queue = [root];
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        const neighbors = [...(adjacency.get(current) || [])].sort((a, b) => nodeOrder.get(a) - nodeOrder.get(b));
        neighbors.forEach((neighbor) => {
          if (visited.has(neighbor)) return;
          visited.add(neighbor);
          children.get(current).push(neighbor);
          queue.push(neighbor);
        });
      }
    });

    const leafCounts = new Map();
    function countLeaves(nodeId) {
      if (leafCounts.has(nodeId)) return leafCounts.get(nodeId);
      const descendants = children.get(nodeId) || [];
      const count = descendants.length
        ? descendants.reduce((total, childId) => total + countLeaves(childId), 0)
        : 1;
      leafCounts.set(nodeId, count);
      return count;
    }

    const radius = nodeRadius();
    const slotWidth = Math.max(165, radius * 2 + 92);
    const componentGap = Math.max(75, slotWidth * 0.45);
    const componentLeafCounts = roots.map(countLeaves);
    const totalWidth = componentLeafCounts.reduce((total, count) => total + count * slotWidth, 0)
      + Math.max(0, roots.length - 1) * componentGap;
    const verticalGap = Math.max(155, radius * 2 + 90);
    const top = 115;
    let left = 600 - totalWidth / 2;
    const positions = new Map();

    function place(nodeId, xLeft, width, depth) {
      positions.set(nodeId, { x: xLeft + width / 2, y: top + depth * verticalGap });
      const descendants = children.get(nodeId) || [];
      if (!descendants.length) return;
      const descendantLeaves = descendants.reduce((total, childId) => total + countLeaves(childId), 0);
      let childLeft = xLeft;
      descendants.forEach((childId) => {
        const childWidth = width * countLeaves(childId) / descendantLeaves;
        place(childId, childLeft, childWidth, depth + 1);
        childLeft += childWidth;
      });
    }

    roots.forEach((root, index) => {
      const width = componentLeafCounts[index] * slotWidth;
      place(root, left, width, 0);
      left += width + componentGap;
    });

    commitMutation(() => {
      graph.nodes.forEach((node) => {
        const position = positions.get(node.id);
        if (position) {
          node.x = position.x;
          node.y = position.y;
        }
      });
      graph.edges.forEach((edge) => {
        if (edge.from === edge.to) return;
        const from = graph.nodes.find((node) => node.id === edge.from);
        const to = graph.nodes.find((node) => node.id === edge.to);
        if (from && to) edge.length = edgeDistance(from, to);
      });
    });
    fitGraph();
    showToast(`已整理为树形布局（${roots.length} 个连通分量）；原有边、自环与重边均保留。`);
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
      .annotation-frame-title{fill:#078aa1;font-family:Arial,sans-serif;font-size:12px;font-weight:700}
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
      graphAnnotation = null;
      graph = imported;
      commandEntries = buildCommandEntriesFromGraph(graph);
      writeCommandInput();
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
    $('#tree-layout-button').addEventListener('click', arrangeAsTree);
    $('#mark-edge-types-button').addEventListener('click', () => applyGraphAnnotation('edge-types'));
    $('#mark-scc-button').addEventListener('click', () => applyGraphAnnotation('scc'));
    $('#mark-vbcc-button').addEventListener('click', () => applyGraphAnnotation('vbcc'));
    $('#mark-ebcc-button').addEventListener('click', () => applyGraphAnnotation('ebcc'));
    $('#undo-annotation-button').addEventListener('click', undoGraphAnnotation);
    const analysisMenu = $('#analysis-toolbar-menu');
    const analysisMenuToggle = $('#analysis-toolbar-toggle');
    const syncAnalysisMenuState = () => {
      analysisMenuToggle.setAttribute('aria-expanded', String(analysisMenu.open));
      analysisMenuToggle.title = analysisMenu.open ? '关闭图分析工具' : '打开图分析工具';
    };
    const closeAnalysisMenu = (restoreFocus = false) => {
      if (analysisMenu.open) analysisMenu.open = false;
      if (restoreFocus) analysisMenuToggle.focus();
    };
    analysisMenu.addEventListener('toggle', syncAnalysisMenuState);
    analysisMenu.addEventListener('click', (event) => {
      const action = event.target.closest?.('.analysis-menu-action');
      if (action) closeAnalysisMenu(true);
    });
    analysisMenu.addEventListener('focusout', (event) => {
      if (event.relatedTarget && !analysisMenu.contains(event.relatedTarget)) closeAnalysisMenu();
    });
    document.addEventListener('pointerdown', (event) => {
      if (analysisMenu.open && !analysisMenu.contains(event.target)) closeAnalysisMenu();
    });
    syncAnalysisMenuState();
    $('#toggle-command-sidebar').addEventListener('click', (event) => {
      const collapsed = commandSidebar.classList.toggle('collapsed');
      event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
      event.currentTarget.setAttribute('aria-label', collapsed ? '展开输入栏' : '收起输入栏');
      event.currentTarget.title = collapsed ? '展开输入栏' : '收起输入栏';
    });
    commandInput.addEventListener('input', handleCommandInput);
    commandInput.addEventListener('compositionend', () => handleCommandInput({ isComposing: false }));
    commandInput.addEventListener('blur', flushCommandInputApply);
    commandInput.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        reconcileCommandInput();
        const lines = commandInput.value.split(/\r?\n/);
        let lineIndex = commandLineIndexAt(commandInput.selectionStart);
        if (!lines[lineIndex]?.trim() && lineIndex > 0) lineIndex -= 1;
        const entryIds = pendingCommandIdsThrough(lineIndex);
        if (!entryIds.length) return;
        window.setTimeout(() => {
          reconcileCommandInput();
          const stillPending = entryIds.filter((id) => commandEntries.some((entry) => entry.id === id
            && entry.text.trim() && (!entry.kind || entry.text !== entry.appliedText)));
          if (stillPending.length) applyBulkInput(stillPending);
        }, 0);
      } else if (event.key === 'Backspace') {
        const previousValue = commandInput.value;
        window.setTimeout(() => {
          if (previousValue === commandInput.value) return;
          reconcileCommandInput();
          const lineIndex = commandLineIndexAt(commandInput.selectionStart);
          const entry = commandEntries[lineIndex];
          if (entry?.text.trim() && commandEntryIsComplete(entry)
            && (!entry.kind || entry.text !== entry.appliedText)) applyBulkInput([entry.id]);
        }, 0);
      }
    });
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
      if (event.key === 'Escape' && analysisMenu.open) {
        event.preventDefault();
        closeAnalysisMenu(true);
        return;
      }
      const target = event.target;
      const inputControl = target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      const interactiveControl = target instanceof HTMLElement && (
        target.isContentEditable || inputControl || ['BUTTON', 'SUMMARY'].includes(target.tagName)
      );
      if (interactiveControl) {
        if (inputControl && event.key === 'Escape') target.blur();
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

  function refreshMathRendering() {
    mathSvgCache.clear();
    renderScene();
  }

  window.addEventListener('graph-studio-mathjax-ready', refreshMathRendering);
  init();
  if (window.MathJax?.tex2svg) {
    const mathJaxReady = window.MathJax.startup?.promise;
    if (mathJaxReady && typeof mathJaxReady.then === 'function') {
      mathJaxReady.then(refreshMathRendering).catch(() => {});
    } else {
      refreshMathRendering();
    }
  }
})();
