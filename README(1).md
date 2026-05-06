# NodeScratch 🔷

A node-based visual programming editor — like Scratch, but with wires.

## Run in GitHub Codespaces

1. Open this repo in a Codespace
2. In the terminal:
   ```bash
   npx live-server --port=3000
   ```
3. When prompted, click **Open in Browser** (or go to the Ports tab)

That's it! No installs, no config.

## How to use

- **Drag** blocks from the left panel onto the canvas
- **Connect** ports by clicking and dragging from one dot to another
  - Square ports (purple) = execution flow
  - Round ports (green) = data values
- **Click a wire** to delete it
- **Right-click a node** to duplicate or delete it
- **Scroll** to zoom, **middle-click** to pan
- Hit **▶ Run** to execute your program

## Example program

Try this to make the sprite bounce around:

```
When Started → Repeat (50) → [loop] → Move (5) → Bounce → back to Repeat
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell |
| `style.css` | All styling |
| `nodes.js` | Block type definitions |
| `engine.js` | Execution engine + sprite |
| `app.js` | Graph, UI, drag/drop, wires |
