export function createToolPanel(container) {
  const toolPanel = container;
  toolPanel.classList.add("tool-panel");

  const tools = [
    { name: "line", icon: "public/icons/line.svg" },
    { name: "extendedline", icon: "public/icons/extended line.svg" },
    { name: "ray", icon: "public/icons/ray.svg" },
    { name: "horizontalline", icon: "public/icons/horizontal line.svg" },
    { name: "verticalline", icon: "public/icons/vertical line.svg" },
  ];

  tools.forEach((tool) => {
    const button = document.createElement("button");
    const img = document.createElement("img");
    img.src = tool.icon;
    img.alt = tool.name;

    button.appendChild(img);
    button.addEventListener("click", () => {
      console.log(`${tool.name} clicked`);
    });

    toolPanel.appendChild(button);
  });
}
