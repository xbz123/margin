import React from 'react';

/**
 * Margin two-line glyph from scripts/icons/glyph.svg.
 * Rendered as inline SVG so it inherits `color` (currentColor) and
 * can be styled freely with className.
 */
export const NativelyLogoMark: React.FC<{
    size?: number;
    className?: string;
}> = ({ size = 18, className = '' }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 22 22"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        <g fill="currentColor">
            <rect x="3.2" y="3" width="1.6" height="16" rx="0.8" />
            <rect x="7" y="6" width="12" height="3.4" rx="1.7" />
            <rect x="7" y="12.5" width="8" height="3.4" rx="1.7" />
        </g>
    </svg>
);
