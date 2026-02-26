import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

// needed for shadcn/ui components that use `clsx` for class merging, but we want to use `tailwind-merge` to handle conflicts
