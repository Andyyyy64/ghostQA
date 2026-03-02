import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const html = await readFile(join(__dirname, "index.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } else if (req.url === "/api/todos") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([
      { id: 1, text: "Buy groceries", done: false },
      { id: 2, text: "Walk the dog", done: true },
      { id: 3, text: "Write tests", done: false },
    ]));
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`Demo app running at http://localhost:${PORT}`);
});
