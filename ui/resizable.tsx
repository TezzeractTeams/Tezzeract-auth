import * as React from "react"
import { cn } from "@/shared/utils/cn"

const ResizablePanelGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    direction?: "horizontal" | "vertical"
  }
>(({ className, direction = "horizontal", children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex h-full w-full",
      direction === "horizontal" ? "flex-row" : "flex-col",
      className
    )}
    {...props}
  >
    {children}
  </div>
))
ResizablePanelGroup.displayName = "ResizablePanelGroup"

const ResizablePanel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    defaultSize?: number
    minSize?: number
    maxSize?: number
  }
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex-1", className)}
    {...props}
  >
    {children}
  </div>
))
ResizablePanel.displayName = "ResizablePanel"

const ResizableHandle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    direction?: "horizontal" | "vertical"
  }
>(({ className, direction = "horizontal", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex items-center justify-center bg-transparent",
      direction === "horizontal" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
      className
    )}
    {...props}
  >
    <div
      className={cn(
        "z-10 bg-border",
        direction === "horizontal" ? "h-full w-px" : "h-px w-full"
      )}
    />
  </div>
))
ResizableHandle.displayName = "ResizableHandle"

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
