# YoungNodes

This repository contains a block-based visual programming editor where blocks are defined in `blocks.json`, and the execution engine is implemented in `engine.js`.

## Engine Code

The JavaScript engine used by YoungNodes is shown below:

```js
class SpriteState {
  constructor(stageW, stageH) {
    this.x = stageW / 2;
    this.y = stageH / 2;
    this.angle = 0; // degrees, 0 = right
    this.color = '#7c6af5';
    this.size = 16;
    this.speech = null;
    this.speechTimer = null;
    this.stageW = stageW;
    this.stageH = stageH;
  }
}

class Engine {
  constructor(graph, stageCanvas, logFn, statusFn) {
    this.graph = graph;
    this.stage = stageCanvas;
    this.ctx = stageCanvas.getContext('2d');
    this.log = logFn;
    this.setStatus = statusFn;
    this.sprite = new SpriteState(stageCanvas.width, stageCanvas.height);
    this.running = false;
    this.keys = {};
    this._setupKeys();
    this._rafId = null;
    this._execQueue = [];
  }

  _setupKeys() {
    window.addEventListener('keydown', e => { this.keys[e.key] = true; });
    window.addEventListener('keyup', e => { this.keys[e.key] = false; });
  }

  async run() {
    if (this.running) return;
    this.running = true;
    this.setStatus('Running');
    this.log('▶ Program started', 'info');
    this.sprite = new SpriteState(this.stage.width, this.stage.height);

    const startNodes = this.graph.nodes.filter(n => n.type === 'start');
    if (!startNodes.length) {
      this.log('No "When Started" block found!', 'error');
      this.stop();
      return;
    }

    this._renderLoop();
    const promises = startNodes.map(n => this._execChain(n, 'exec'));
    await Promise.all(promises);

    if (this.running) this.stop();
  }

  stop() {
    this.running = false;
    this._rafId && cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.setStatus('Stopped');
    this.log('■ Program stopped', 'info');
    this._drawSprite();
  }

  _renderLoop() {
    if (!this.running) return;
    this._drawSprite();
    this._rafId = requestAnimationFrame(() => this._renderLoop());
  }

  _drawSprite() {
    const { ctx, sprite } = this;
    const W = this.stage.width, H = this.stage.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111118';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    ctx.save();
    ctx.translate(sprite.x, sprite.y);
    ctx.rotate((sprite.angle * Math.PI) / 180);
    const s = sprite.size;
    ctx.fillStyle = sprite.color;
    ctx.shadowColor = sprite.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.6, -s * 0.6);
    ctx.lineTo(-s * 0.3, 0);
    ctx.lineTo(-s * 0.6, s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (sprite.speech) {
      ctx.save();
      const tx = Math.min(sprite.x + 10, W - 120);
      const ty = Math.max(sprite.y - 40, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = sprite.color;
      ctx.lineWidth = 2;
      const tw = ctx.measureText(sprite.speech).width + 16;
      const th = 24;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, th, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.font = '11px DM Sans, sans-serif';
      ctx.fillText(sprite.speech, tx + 8, ty + 16);
      ctx.restore();
    }
  }

  async _execChain(node, execPort) {
    if (!this.running) return;
    this.graph.flashNode(node.id);

    try {
      await this._execNode(node);
    } catch (e) {
      this.log(`Error in ${node.type}: ${e.message}`, 'error');
      return;
    }

    const nextNodes = this.graph.getExecOutputs(node.id, execPort === 'exec' ? 'exec' : execPort);
    for (const { node: nextNode } of nextNodes) {
      if (!this.running) return;
      await this._execChain(nextNode, 'exec');
    }
  }

  async _execNode(node) {
    const val = (portId) => this._resolveInput(node, portId);
    const sp = this.sprite;

    switch (node.type) {
      case 'start':
        break;

      case 'move': {
        const steps = await val('steps') ?? node.fields.steps ?? 10;
        const rad = (sp.angle * Math.PI) / 180;
        sp.x += steps * Math.cos(rad);
        sp.y += steps * Math.sin(rad);
        this.log(`move ${steps} steps → (${sp.x.toFixed(1)}, ${sp.y.toFixed(1)})`);
        break;
      }

      case 'turn': {
        const deg = await val('degrees') ?? node.fields.degrees ?? 15;
        sp.angle = (sp.angle + deg) % 360;
        this.log(`turn ${deg}° → angle ${sp.angle.toFixed(1)}°`);
        break;
      }

      case 'goto': {
        const x = await val('x') ?? node.fields.x ?? 120;
        const y = await val('y') ?? node.fields.y ?? 90;
        sp.x = +x; sp.y = +y;
        this.log(`go to (${sp.x}, ${sp.y})`);
        break;
      }

      case 'bounce': {
        if (sp.x <= sp.size || sp.x >= sp.stageW - sp.size) sp.angle = 180 - sp.angle;
        if (sp.y <= sp.size || sp.y >= sp.stageH - sp.size) sp.angle = -sp.angle;
        sp.x = Math.max(sp.size, Math.min(sp.stageW - sp.size, sp.x));
        sp.y = Math.max(sp.size, Math.min(sp.stageH - sp.size, sp.y));
        this.log('bounce off edge');
        break;
      }

      case 'say': {
        const text = await val('text') ?? node.fields.text ?? '';
        sp.speech = String(text);
        this.log(`say: "${text}"`);
        clearTimeout(sp.speechTimer);
        sp.speechTimer = setTimeout(() => { sp.speech = null; }, 2000);
        break;
      }

      case 'setcolor': {
        sp.color = node.fields.color ?? '#7c6af5';
        this.log(`color → ${sp.color}`);
        break;
      }

      case 'setsize': {
        const size = await val('size') ?? node.fields.size ?? 20;
        sp.size = Math.max(4, +size);
        this.log(`size → ${sp.size}`);
        break;
      }

      case 'wait': {
        const ms = await val('ms') ?? node.fields.ms ?? 500;
        this.log(`wait ${ms}ms`);
        await this._sleep(+ms);
        break;
      }

      case 'repeat': {
        const times = await val('times') ?? node.fields.times ?? 10;
        for (let i = 0; i < +times; i++) {
          if (!this.running) return;
          this.log(`repeat ${i + 1}/${times}`);
          const loopNodes = this.graph.getExecOutputs(node.id, 'loop');
          for (const { node: ln } of loopNodes) {
            await this._execChain(ln, 'exec');
          }
        }
        const doneNodes = this.graph.getExecOutputs(node.id, 'done');
        for (const { node: dn } of doneNodes) {
          await this._execChain(dn, 'exec');
        }
        return;
      }

      case 'if': {
        const cond = await val('cond') ?? false;
        const branch = cond ? 'true' : 'false';
        this.log(`if → ${cond ? 'true' : 'false'}`);
        const branchNodes = this.graph.getExecOutputs(node.id, branch);
        for (const { node: bn } of branchNodes) {
          await this._execChain(bn, 'exec');
        }
        return;
      }

      default:
        break;
    }
  }

  async _resolveInput(node, portId) {
    const wire = this.graph.getDataInput(node.id, portId);
    if (!wire) return undefined;
    return await this._evalDataNode(wire.sourceNode, wire.sourcePort);
  }

  async _evalDataNode(node, outputPort) {
    switch (node.type) {
      case 'number': return +(node.fields.value ?? 0);
      case 'add': {
        const a = await this._resolveOrField(node, 'a');
        const b = await this._resolveOrField(node, 'b');
        return a + b;
      }
      case 'multiply': {
        const a = await this._resolveOrField(node, 'a');
        const b = await this._resolveOrField(node, 'b');
        return a * b;
      }
      case 'random': {
        const min = await this._resolveOrField(node, 'min');
        const max = await this._resolveOrField(node, 'max');
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }
      case 'keypressed': {
        const key = node.fields.key ?? 'ArrowRight';
        return !!this.keys[key];
      }
      case 'getx': return this.sprite.x;
      case 'gety': return this.sprite.y;
      default: return undefined;
    }
  }

  async _resolveOrField(node, portId) {
    const wire = this.graph.getDataInput(node.id, portId);
    if (wire) return await this._evalDataNode(wire.sourceNode, wire.sourcePort);
    return +(node.fields[portId] ?? 0);
  }

  _sleep(ms) {
    return new Promise(resolve => {
      const check = () => {
        if (!this.running) { resolve(); return; }
        resolve();
      };
      setTimeout(check, ms);
    });
  }
}
```
