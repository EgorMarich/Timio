export class TemplateEngine {
    render(template, variables) {
        return template.replace(/\{\{(.*?)\}\}/g, (_, key) => String(variables[key.trim()] ?? ""));
    }
}
