// Feedback visual rico pro drag-and-drop dos kanbans.
// Substitui o "ghost" padrão do browser por uma cópia estilizada do card
// (rotação leve + sombra forte) que dá sensação de "pegar e levar".

/**
 * Configura uma drag image customizada baseada no próprio elemento sendo
 * arrastado. Clona, aplica estilo de "card flutuando" e usa setDragImage.
 * O ghost é removido do DOM logo após o browser capturar a imagem.
 */
export function setupDragImage(e: React.DragEvent<HTMLElement>): void {
  const original = e.currentTarget;
  if (!original) return;

  const rect = original.getBoundingClientRect();
  const ghost = original.cloneNode(true) as HTMLElement;

  // Posiciona fora da tela enquanto o browser captura
  ghost.style.position = 'fixed';
  ghost.style.top = '-1000px';
  ghost.style.left = '-1000px';
  ghost.style.width = `${rect.width}px`;
  ghost.style.pointerEvents = 'none';

  // Visual: levemente rotacionado, sombra forte, escala um pouco maior
  ghost.style.transform = 'rotate(-2deg) scale(1.03)';
  ghost.style.transformOrigin = 'center';
  ghost.style.boxShadow = '0 20px 40px -10px rgba(0,0,0,0.4), 0 8px 16px -4px rgba(0,0,0,0.2)';
  ghost.style.opacity = '0.95';
  ghost.style.borderRadius = getComputedStyle(original).borderRadius;
  ghost.style.background = getComputedStyle(original).backgroundColor || 'white';

  document.body.appendChild(ghost);

  // Browser tira o snapshot na linha abaixo; depois removemos o ghost
  // (precisa estar no DOM pra setDragImage funcionar)
  e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top);

  // Remove no próximo tick — depois que o browser já capturou
  window.setTimeout(() => {
    if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
  }, 0);
}
