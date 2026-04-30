import iconUrl from '@/images/icon.png';

interface Props {
  size?: number;        // tamanho em px (default 28)
  className?: string;
  alt?: string;
}

export default function Logo({ size = 28, className = '', alt = 'EGP Indústria' }: Props) {
  return (
    <img
      src={iconUrl}
      alt={alt}
      width={size}
      height={size}
      className={`shrink-0 rounded-md object-contain ${className}`}
    />
  );
}
