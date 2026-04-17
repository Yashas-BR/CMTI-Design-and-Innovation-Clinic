import { useEffect, useMemo, useState } from "react";

import BinMap from "@/components/BinMap";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DataRow } from "@/types/dashboard";

type BinLocationPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPoint: [number, number] | null;
  onApply: (latitude: number, longitude: number) => void;
};

const EMPTY_ROWS: DataRow[] = [];

function BinLocationPickerDialog({
  open,
  onOpenChange,
  selectedPoint,
  onApply,
}: BinLocationPickerDialogProps) {
  const [draftPoint, setDraftPoint] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (open) {
      setDraftPoint(selectedPoint);
    }
  }, [open, selectedPoint]);

  const selectedText = useMemo(() => {
    if (!draftPoint) {
      return "Click the map to choose coordinates.";
    }
    return `${draftPoint[0].toFixed(6)}, ${draftPoint[1].toFixed(6)}`;
  }, [draftPoint]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[88vh] w-[95vw] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:w-[92vw] sm:max-w-300">
        <DialogHeader>
          <DialogTitle>Select Bin Coordinates</DialogTitle>
          <DialogDescription>
            Click anywhere on the map to set bin latitude and longitude.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Selected: {selectedText}
        </p>

        <BinMap
          rows={EMPTY_ROWS}
          title="Click map to place bin"
          heightClassName="h-[340px] sm:h-[430px] lg:h-[560px]"
          onMapClick={(latitude, longitude) =>
            setDraftPoint([latitude, longitude])
          }
          selectedPoint={draftPoint}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!draftPoint) {
                return;
              }
              onApply(draftPoint[0], draftPoint[1]);
              onOpenChange(false);
            }}
            disabled={!draftPoint}
          >
            Use This Location
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BinLocationPickerDialog;
