export function createToolPanel(container) {
  const toolPanel = container;

  const tools = ["1", "2", "3"];
  tools.forEach((toolName) => {
    const button = document.createElement("button");
    button.textContent = toolName;
    button.addEventListener("click", () => {
      console.log(`${toolName} clicked`);
    });
    toolPanel.appendChild(button);
  });
}
