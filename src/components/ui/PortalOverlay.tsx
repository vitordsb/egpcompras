import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  children: ReactNode;
}

/**
 * Renderiza children no document.body via portal.
 * Resolve bug de modais sendo cortados/empilhados errado por
 * containers ancestrais com overflow/transform/position.
 *
 * Uso:
 *   <PortalOverlay>
 *     <div className="fixed inset-0 z-50 ...">...</div>
 *   </PortalOverlay>
 */
export default function PortalOverlay({ children }: Props) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
