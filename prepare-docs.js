// Fully written by Gemini

const fs = require('fs');
const path = require('path');

// Read your standard GitHub README
const readmePath = path.join(__dirname, 'README.md');
let content = fs.readFileSync(readmePath, 'utf8');

// Replace standard markdown tutorial links with JSDoc HTML links
// E.g., [My Tutorial](tutorials/my-tutorial.md) -> [My Tutorial](tutorial-my-tutorial.html)
// Matches links like ./tutorials/AudioReception.md or tutorials/AudioReception.md
content = content.replace(/\[([^\]]+)\]\((?:\.\/)?tutorials\/([^.]+)\.md\)/g, (match, linkText, fileName) => {
    // Converts "AudioReception" to "audioreception" and formats the URL
    return `[${linkText}](tutorials/${fileName.toLowerCase()})`;
});
// Write the modified content to a new temporary file for JSDoc
const outPath = path.join(__dirname, 'README-docs.md');
fs.writeFileSync(outPath, content);

console.log("Generated README-docs.md for JSDoc.");
