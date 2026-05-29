import { X } from 'lucide-react';

type ModalCloseButtonProps = {
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
};

export const ModalCloseButton = ({
  onClick,
  ariaLabel = 'Close modal',
  className = '',
  disabled = false,
}: ModalCloseButtonProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[#FF5F40]/35 hover:bg-[#FFF7F3] hover:text-[#FF5F40] focus:outline-none focus:ring-2 focus:ring-[#FF5F40]/20 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-300 disabled:hover:border-gray-200 disabled:hover:bg-gray-50 disabled:hover:text-gray-300 ${className}`}
    >
      <X size={16} />
    </button>
  );
};
