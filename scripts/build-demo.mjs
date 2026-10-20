// 体験版を 1 つの HTML にまとめる（npm run build:demo）。
// vite が dist-demo に出した JS と CSS を埋め込み、dist-demo/voicepeak-editor-demo.html を作る。
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const dir = "dist-demo/assets";
const files = readdirSync(dir);
const read = (ext) => readFileSync(`${dir}/${files.find((f) => f.endsWith(ext))}`, "utf8");
const js = read(".js").replace(/<\/script/gi, "<\\/script");
const css = read(".css");

const html = `<title>VOICEPEAK 編集ソフト 体験版</title>
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync("dist-demo/voicepeak-editor-demo.html", html);
console.log(`dist-demo/voicepeak-editor-demo.html (${Math.round(html.length / 1024)} KB)`);
