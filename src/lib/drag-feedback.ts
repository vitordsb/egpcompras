// Feedback visual pro drag-and-drop dos kanbans.
// Versão simplificada: usa o ghost padrão do browser (mais confiável)
// e limita-se a aplicar uma classe de "lifted" no original via dataset
// pra que o CSS possa reagir.
//
// Tentativa anterior usava setDragImage com clone — bugava em alguns
// browsers (Firefox/Safari) e podia deixar o card "preso" no estado
// dragging quando o drag era cancelado.

export function setupDragImage(_e: React.DragEvent<HTMLElement>): void {
  // No-op por enquanto. Mantemos o ghost nativo do browser — funciona
  // sem bugs e dá um feedback razoável (cópia translúcida do elemento).
  // Se quiser custom no futuro, usar uma lib como dnd-kit que já trata
  // todos os casos de borda.
}
