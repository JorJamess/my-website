import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Pupu } from "@/components/app/pupu";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="group/pupu">
        <Pupu pose="oops" size={132} title="Pupu looks worried" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-[32px] font-semibold tracking-tight">That page doesn&rsquo;t exist</h1>
        <p className="text-[16px] text-muted-foreground">The link may be old, or mistyped.</p>
        <p lang="th" className="text-[15px] text-muted-foreground">ไม่พบหน้านี้ ลิงก์อาจเก่าหรือพิมพ์ผิด</p>
      </div>
      <Button asChild className="h-11 rounded-full px-6">
        <Link href="/">Back to the portfolio</Link>
      </Button>
    </main>
  );
}
