const fs = require("fs");

const mappings = [
  ["richMenuEditorHtml", "src/rich-menu-editor.html"],
  ["flexTemplateEditorHtml", "src/flex-template-editor.html"],
  ["vendorManagementHtml", "src/vendor-management.html"],
  ["vendorApplyHtml", "src/vendor-apply.html"],
  ["lineOaMonitorHtml", "src/line-oa-monitor.html"],
  ["lineSegmentPushHtml", "src/line-segment-push.html"],
];

let source = fs.readFileSync("src/index.js", "utf8");

function replaceStringConstant(input, name, value) {
  const marker = `const ${name} = `;
  const start = input.indexOf(marker);
  if (start < 0) throw new Error(`Missing constant: ${name}`);

  let i = start + marker.length;
  while (/\s/.test(input[i])) i++;
  const quote = input[i];
  if (quote !== "\"" && quote !== "`") {
    throw new Error(`Unsupported literal for ${name}`);
  }

  let j = i + 1;
  let escaped = false;
  if (quote === "\"") {
    for (; j < input.length; j++) {
      const ch = input[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"" && input[j + 1] === ";") break;
    }
  } else {
    for (; j < input.length; j++) {
      const ch = input[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "`" && input[j + 1] === ";") break;
    }
  }

  if (j >= input.length) throw new Error(`Could not find end of ${name}`);
  const nextLiteral = JSON.stringify(value);
  return input.slice(0, i) + nextLiteral + input.slice(j + 1);
}

for (const [name, file] of mappings) {
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");
  source = replaceStringConstant(source, name, html);
  console.log(`synced ${name} <= ${file} (${html.length} chars)`);
}

fs.writeFileSync("src/index.js", source, "utf8");
