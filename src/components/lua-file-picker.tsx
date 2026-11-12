import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 5 * 1024 * 1024;

export function LuaFilePicker({
  onLoaded,
}: {
  onLoaded: (text: string, fileName: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const read = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(lua|luau|txt)$/i.test(file.name)) {
      toast.error("Choose a .lua, .luau or .txt file");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File is larger than 5 MB");
      return;
    }
    const text = await file.text();
    onLoaded(text, file.name);
    toast.success(`Loaded ${file.name}`);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void read(e.dataTransfer.files[0]);
      }}
      className={`flex flex-wrap items-center gap-3 rounded-md border border-dashed px-3 py-3 text-sm ${over ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
    >
      <input
        ref={input}
        type="file"
        accept=".lua,.luau,.txt,text/plain"
        className="hidden"
        onChange={(e) => {
          void read(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
        Upload .lua file
      </Button>
      <span>or drop a file here (max 5 MB)</span>
    </div>
  );
}