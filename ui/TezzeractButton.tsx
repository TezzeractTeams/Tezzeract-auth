import React from "react";
import { cn } from "@/shared/utils/cn";

export interface TezzeractButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  fullWidth?: boolean;
  children: React.ReactNode;
}

export const TezzeractButton = React.forwardRef<HTMLButtonElement, TezzeractButtonProps>(
  ({ className, fullWidth = false, children, ...props }, ref) => {
    // Base styles from Figma with smooth transitions
    const baseStyles = "inline-flex flex-row items-center text-[14px] justify-center gap-2 font-thin focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden whitespace-nowrap";
    
    // Layout and spacing
    const layoutStyles = "max-h-10 px-6 py-3 rounded-xl";
    
    // Border and text
    const borderStyles = "border border-white/40 text-white";
    
    // Width style
    const widthStyle = fullWidth ? "w-full" : "";

    return (
      <button
        ref={ref}
        className={cn(
          baseStyles,
          layoutStyles,
          borderStyles,
          widthStyle,
          "bg-[radial-gradient(64.46%_80%_at_50.53%_0%,#009BE9_0%,#00378A_100%)]",
          "before:content-[''] before:absolute before:inset-0 before:rounded-xl before:opacity-0 before:transition-opacity before:duration-300 before:ease-in-out",
          "before:bg-[radial-gradient(93.12%_100%_at_50.53%_0%,#009BE9_0%,#00378A_100%)]",
          "hover:before:opacity-100",
          "hover:shadow-[0_0_10px_0_rgba(0,169,238,0.40)]",
          "transition-shadow duration-400 ease-in-out",
          className
        )}
        {...props}
      >
        <div className="relative z-10 inline-flex items-center gap-2">{children}</div>
      </button>
    );
  }
);

TezzeractButton.displayName = "TezzeractButton";

