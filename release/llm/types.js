export async function executeTool(tools, name, rawInput) {
    const tool = tools.find((t) => t.name === name);
    if (!tool)
        return { output: `Outil inconnu : ${name}`, images: [], isError: true };
    const parsed = tool.input.safeParse(rawInput);
    if (!parsed.success) {
        return { output: `Entrée invalide pour ${name} : ${parsed.error.message}`, images: [], isError: true };
    }
    try {
        const out = await tool.run(parsed.data);
        const text = typeof out === 'string' ? out : out.text;
        const images = typeof out === 'string' ? [] : out.images ?? [];
        return { output: text.length > 60_000 ? `${text.slice(0, 60_000)}\n…[tronqué]` : text, images, isError: false };
    }
    catch (err) {
        return { output: `Erreur de l'outil ${name} : ${err.message}`, images: [], isError: true };
    }
}
//# sourceMappingURL=types.js.map