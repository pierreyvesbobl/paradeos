"use client";

import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { fr } from "react-day-picker/locale";
import "react-day-picker/style.css";

export function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={fr}
      weekStartsOn={1}
      className={cn("rdp-paradeos p-3", className)}
      classNames={{
        chevron: "fill-current",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          ),
        ...props.components,
      }}
      {...props}
    />
  );
}
