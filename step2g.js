const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const target1 = `  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showPreview) return;

    if (e.key === 'Enter' || e.key === ' ') {
      bundlePreviousChars();
    }`;

code = code.replace(/  const handleTextareaKeyDown = \(e: React\.KeyboardEvent<HTMLDivElement>\) => \{\s*if \(showPreview\) return;\s*if \(e\.key === 'Enter'\) \{/, target1 + "\n\n    if (e.key === 'Enter') {");

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('injected bundle call');
