import React from "react";
import { cn } from "@/shared/utils/cn";
import sendIcon from "@/assets/images/send.svg";

export interface TezzeractSendButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  iconSize?: number;
}

export const TezzeractSendButton = React.forwardRef<HTMLButtonElement, TezzeractSendButtonProps>(
  ({ className, iconSize = 20, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "flex-shrink-0 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-opacity",
          className
        )}
        style={{
          width: '42px',
          height: '42px',
          borderRadius: '10px',
          border: '1px solid #409AFF',
          background: 'linear-gradient(209.1deg, #20C8F9 10.41%, #00378A 89.59%)',
          gap: '4px',
        }}
        {...props}
      >
        <img src={sendIcon} alt="Send" style={{ width: `${iconSize}px`, height: `${iconSize}px` }} />
      </button>
    );
  }
);

TezzeractSendButton.displayName = "TezzeractSendButton";
