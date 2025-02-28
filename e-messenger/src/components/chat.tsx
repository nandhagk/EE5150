import { Send, Edit, Trash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

export interface Message {
  isSelf: boolean;
  content: string;
}

export interface ChatProps {
  receiver: User;
  messages: Message[];
  onSendMessage: (message: string) => void;
  onDeleteChat: (user: User) => void;
  onEditChat: (user: User) => void;
}

export function Chat({ receiver: user, messages, onSendMessage, onDeleteChat, onEditChat }: ChatProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (!scrollArea) return;

    scrollArea.scrollTop = scrollArea.scrollHeight;
  }, [messages]);

  const [input, setInput] = useState("");
  const inputLength = input.trim().length;

  return (
    <>
      <div className="bg-card text-card-foreground flex flex-col gap-6 py-4">
        <div className="gap-1.5 pb-2 border-b-2 flex flex-row justify-between">
          <UserAvatar user={user} />
          <div className="float-end">
            <Button hidden={true} className="m-2" size="icon" onClick={() => onEditChat(user)} >
                <Edit />
                <span className="sr-only">Edit</span>
              </Button>
            <Button  size="icon" onClick={() => onDeleteChat(user)}>
                <Trash/>
                <span className="sr-only">Delete</span>
              </Button>

          </div>

          
        </div>
        <div>
          <ScrollArea ref={scrollAreaRef} className="h-[500px] p-4">
            <div className="space-y-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex w-max xl:max-w-2xl lg:max-w-xl md:max-w-lg sm:max-w-md max-w-sm flex-col gap-2 rounded-lg px-3 py-2 text-sm break-words",
                    message.isSelf ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  {message.content}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
        <div className="flex items-center">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (inputLength === 0) return;
              onSendMessage(input);
              setInput("");
            }}
            className="flex w-full items-center space-x-2"
          >
            <Input
              id="message"
              placeholder="Type your message"
              className="flex-1"
              autoComplete="off"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <Button type="submit" size="icon" disabled={inputLength === 0}>
              <Send />
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}