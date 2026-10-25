"use client";

import { useState } from "react";
import { LoaderCircle, LogIn } from "lucide-react";
import { dismissPreviousRoom, rejoinPreviousRoom, useRoom } from "@/lib/rooms/client";
import { Button, Sheet } from "@/components/ui";

export default function RoomResumePrompt() {
  const open = useRoom((state) => state.resumePrompt);
  const session = useRoom((state) => state.session);
  const [joining, setJoining] = useState(false);

  async function rejoin() {
    if (joining) return;
    setJoining(true);
    await rejoinPreviousRoom();
    setJoining(false);
  }

  function notNow() {
    if (!joining) dismissPreviousRoom();
  }

  if (!session) return null;
  return (
    <Sheet
      open={open}
      onClose={notNow}
      title="Join your previous room?"
      subtitle={session.name ? `Rejoin as ${session.name} and continue listening with everyone.` : "You were listening with friends before you left Sidify."}
      width={420}
    >
      <div className="rounded-[12px] bg-fill p-3 text-[13px] text-fg-2">
        Room code <span className="ml-1 font-mono font-bold tracking-wider text-fg">{session.code}</span>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={notNow} disabled={joining}>Not now</Button>
        <Button onClick={() => void rejoin()} disabled={joining}>
          {joining ? <LoaderCircle size={17} className="animate-spin" /> : <LogIn size={17} />}
          Join room
        </Button>
      </div>
    </Sheet>
  );
}
