import "@/App.css";
import { Chat, Message } from "@/components/chat";
import { NewChat } from "@/components/new-chat";
import { Settings } from "@/components/settings";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, UserAvatar } from "@/components/ui/user-avatar";
import { ControlPacket, DataPacket, ManagementPacket, Packet } from "@/lib/client";
import { MessageSquarePlus, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

const DEFAULT_SETTINGS: Settings = { clientID: 1, socketURL: "ws://localhost:12345", pollInterval: 1000 };

function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const { clientID, socketURL, pollInterval } = settings;
  const { readyState, lastMessage, sendMessage } = useWebSocket(socketURL, { disableJson: true });

  const [packet, setPacket] = useState<Packet | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const [users, setUsers] = useState<User[]>([]);
  const [receiver, setReceiver] = useState<User | null>(null);

  const userKey = `${socketURL}|${clientID}`;
  const messageKey = (receiverID: number) => `${socketURL}|${clientID}|${receiverID}`;

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const rawSettings = localStorage.getItem("settings");
    const oldSettings: Settings = rawSettings !== null ? JSON.parse(rawSettings) : DEFAULT_SETTINGS;

    setSettings(oldSettings);
  }, []);

  useEffect(() => {
    const rawUsers = localStorage.getItem(userKey);
    const savedUsers: User[] = rawUsers !== null ? JSON.parse(rawUsers) : [];

    setUsers(savedUsers);

    if (receiver === null) return;

    const packetKey = messageKey(receiver.id);

    const rawMessages = localStorage.getItem(packetKey);
    const oldMessages: Message[] = rawMessages !== null ? JSON.parse(rawMessages) : [];

    setMessages(oldMessages);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketURL, clientID, receiver]);

  useEffect(() => {
    if (readyState !== ReadyState.OPEN) return;

    sendMessage(ManagementPacket.associate(clientID).encode());

    const intervalID = setInterval(() => sendMessage(ControlPacket.get(clientID).encode()), pollInterval);
    return () => clearInterval(intervalID);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, readyState]);

  const process = async (data: Blob) => {
    const buffer = await data.arrayBuffer();
    setPacket(Packet.decode(buffer));
  };

  useEffect(() => {
    if (readyState !== ReadyState.OPEN || lastMessage === null) return;

    process(lastMessage.data);
  }, [readyState, lastMessage]);

  useEffect(() => {
    if (packet === null) return;

    if (packet.isData() && packet.isGetResponse()) {
      const packetKey = messageKey(packet.id2);

      const rawMessages = localStorage.getItem(packetKey);
      const oldMessages: Message[] = rawMessages !== null ? JSON.parse(rawMessages) : [];
      const newMessages = [...oldMessages, { isSelf: false, content: packet.payload }];

      console.log(packet);

      localStorage.setItem(packetKey, JSON.stringify(newMessages));
      if (packet.id2 === receiver?.id) setMessages([...messages, { isSelf: false, content: packet.payload }]);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packet]);

  const onSendMessage = (message: string) => {
    if (receiver === null) return;

    sendMessage(DataPacket.push(clientID, receiver.id, message).encode());

    const packetKey = messageKey(receiver.id);

    const newMessages = [...messages, { isSelf: true, content: message }];
    setMessages(newMessages);

    localStorage.setItem(packetKey, JSON.stringify(newMessages));
  };

  const onNewChat = (user: User) => {
    const newUsers = [user, ...users];

    setUsers(newUsers);
    localStorage.setItem(userKey, JSON.stringify(newUsers));

    setIsNewOpen(false);
  };

  const onUpdateSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    localStorage.setItem("settings", JSON.stringify(newSettings));

    setIsSettingsOpen(false);
  };

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <div className="w-full h-full flex justify-center items-center p-8">
        <div className="w-6xl flex justify-center items-center border p-2 gap-2 shadow-sm">
          <div className="w-72 p-2 flex flex-col gap-2">
            <div className="flex flex-row gap-2">
              <h3 className="text-2xl">Chats</h3>
              <Button className="ml-auto cursor-pointer" type="button" size="icon" onClick={() => setIsNewOpen(true)}>
                <MessageSquarePlus />
                <span className="sr-only">New</span>
              </Button>
              <Button className="cursor-pointer" type="button" size="icon" onClick={() => setIsSettingsOpen(true)}>
                <SettingsIcon />
                <span className="sr-only">Settings</span>
              </Button>
            </div>
            <div className="h-[600px]">
              <Command>
                <CommandInput placeholder="Search" />
                <CommandList>
                  <ScrollArea type="auto" className="h-[560px]">
                    <CommandEmpty>No chats found.</CommandEmpty>
                    <CommandGroup>
                      {users.map((user, index) => (
                        <CommandItem key={index} className="cursor-pointer py-2" onSelect={() => setReceiver(user)}>
                          <div>
                            <UserAvatar user={user} />
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </ScrollArea>
                </CommandList>
              </Command>
            </div>
          </div>
          <div className="flex-1">{receiver === null ? <></> : <Chat receiver={receiver} messages={messages} onSendMessage={onSendMessage} />}</div>
        </div>
      </div>
      <NewChat isOpen={isNewOpen} setIsOpen={setIsNewOpen} onCreate={onNewChat} />
      <Settings isOpen={isSettingsOpen} setIsOpen={setIsSettingsOpen} settings={settings} setSettings={onUpdateSettings} />
    </ThemeProvider>
  );
}

export default App;
