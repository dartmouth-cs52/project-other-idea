import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, List, ListOrdered, Redo, Undo } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// A real contenteditable editor (ProseMirror). Its toolbar buttons are
// icon-only with titles, and the editing area is not an <input>.

export function RichText({ value, onChange, label }: { value: string; onChange: (html: string) => void; label: string }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editorProps: { attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true", class: "px-3 py-2 text-[13px]" } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  if (!editor) return null;
  const tool = (active: boolean, title: string, icon: ReactNode, run: () => void) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn("grid size-7 cursor-pointer place-items-center rounded text-ink-2 hover:bg-sunken [&_svg]:size-4", active && "bg-sunken text-ink")}
    >
      {icon}
    </button>
  );
  return (
    <div className="overflow-hidden rounded-md border border-line-strong bg-panel focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
      <div role="toolbar" aria-label={`${label} formatting`} className="flex gap-0.5 border-b border-line bg-sunken/50 p-1">
        {tool(editor.isActive("bold"), "Bold", <Bold />, () => editor.chain().focus().toggleBold().run())}
        {tool(editor.isActive("italic"), "Italic", <Italic />, () => editor.chain().focus().toggleItalic().run())}
        {tool(editor.isActive("heading", { level: 2 }), "Heading", <Heading2 />, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        {tool(editor.isActive("bulletList"), "Bulleted list", <List />, () => editor.chain().focus().toggleBulletList().run())}
        {tool(editor.isActive("orderedList"), "Numbered list", <ListOrdered />, () => editor.chain().focus().toggleOrderedList().run())}
        <span className="mx-1 w-px bg-line" />
        {tool(false, "Undo", <Undo />, () => editor.chain().focus().undo().run())}
        {tool(false, "Redo", <Redo />, () => editor.chain().focus().redo().run())}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
