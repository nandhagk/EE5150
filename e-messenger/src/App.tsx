import "@/App.css";
import { Chat, Message } from "@/components/chat";
import { NewChat } from "@/components/new-chat";
import { Settings } from "@/components/settings";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/sonner";
import { User, UserAvatar } from "@/components/ui/user-avatar";
import { ControlPacket, DataPacket, ManagementPacket, Packet } from "@/lib/client";
import { MessageSquarePlus, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const POLL_INTERVAL = 1000;
const DEFAULT_SETTINGS: Settings = { clientID: 1, socketURL: "ws://localhost:12345" };

interface Request {
  resolve: (packet: Packet) => void;
  reject: () => void;
}

function App() {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const { clientID, socketURL } = settings;

  const clientIDRef = useRef(clientID);
  useEffect(() => {
    clientIDRef.current = clientID;
  }, [clientID]);

  const [webSocket, setWebSocket] = useState<WebSocket | null>(null);

  const webSocketRef = useRef(webSocket);
  useEffect(() => {
    webSocketRef.current = webSocket;
  }, [webSocket]);

  const [requests, setRequests] = useState<Request[]>([]);
  const requestsRef = useRef(requests);
  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);

  const [intervalID, setIntervalID] = useState<ReturnType<typeof setInterval> | null>(null);

  const intervalIDRef = useRef(intervalID);
  useEffect(() => {
    intervalIDRef.current = intervalID;
  }, [intervalID]);

  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [receiver, setReceiver] = useState<User | null>(null);

  const receiverRef = useRef(receiver);
  useEffect(() => {
    receiverRef.current = receiver;
  }, [receiver]);

  const settingsKey = "settings";
  const userKey = useMemo(() => `${socketURL}|${clientID}`, [socketURL, clientID]);
  const chatKey = useCallback((receiverID: number) => `${userKey}|${receiverID}`, [userKey]);

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const rawSettings = localStorage.getItem(settingsKey);
    const settings: Settings = rawSettings !== null ? JSON.parse(rawSettings) : { ...DEFAULT_SETTINGS };

    setSettings(settings);
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, []);

  useEffect(() => {
    if (webSocketRef.current !== null && webSocketRef.current.readyState === WebSocket.OPEN) {
      webSocketRef.current.addEventListener("close", () => {
        const webSocket = new WebSocket(socketURL);
        webSocket.binaryType = "arraybuffer";

        setWebSocket(webSocket);
      });
      webSocketRef.current.close();
    } else {
      const webSocket = new WebSocket(socketURL);
      webSocket.binaryType = "arraybuffer";

      setWebSocket(webSocket);
    }
  }, [socketURL, clientID]);

  const sendPacket = (packet: Packet): Promise<Packet> => {
    if (webSocket === null) throw new Error("HOW");

    return new Promise((resolve, reject) => {
      setRequests((requests) => [...requests, { resolve, reject }]);
      webSocket.send(packet.encode());
    });
  };

  useEffect(() => {
    setReceiver(null);

    for (const request of requestsRef.current) request.reject();
    setRequests([]);

    if (intervalIDRef.current !== null) clearInterval(intervalIDRef.current);
    setIntervalID(null);

    if (webSocket === null) return;

    webSocket.addEventListener("message", async (event: MessageEvent<ArrayBuffer>) => {
      const packet = Packet.decode(event.data);

      if (requestsRef.current.length === 0) return; // Probably from previous websocket?
      const [request, ...requests] = requestsRef.current;

      if (packet !== null) {
        request.resolve(packet);
      } else {
        request.reject();
      }

      setRequests(requests);
    });

    webSocket.addEventListener("open", async () => {
      setReceiver(null);

      for (const request of requestsRef.current) request.reject();
      setRequests([]);

      if (intervalIDRef.current !== null) clearInterval(intervalIDRef.current);
      setIntervalID(null);

      try {
        const response = await sendPacket(ManagementPacket.associate(clientIDRef.current));
        if (response.isManangement() && response.isUnknownError()) {
          toast.error("Association failed!");
        } else if (response.isManangement() && response.isAssociationSuccess()) {
          toast.info("Associated!");

          if (intervalIDRef.current !== null) clearInterval(intervalIDRef.current);

          const intervalID = setInterval(async () => {
            for (;;) {
              try {
                const response = await sendPacket(ControlPacket.get(clientIDRef.current));
                if (response.isControl() && response.isBufferEmpty()) break;

                if (response.isData() && response.isGetResponse()) {
                  const rawMessages = localStorage.getItem(chatKey(response.id2));
                  const oldMessages: Message[] = rawMessages !== null ? JSON.parse(rawMessages) : [];

                  const messages = [...oldMessages, { isSelf: false, content: response.payload }];

                  if (response.id2 === receiverRef.current?.id) setMessages(messages);
                  localStorage.setItem(chatKey(response.id2), JSON.stringify(messages));

                  if (users.find(({ id }) => id === response.id2) === undefined) {
                    const user = {
                      id: response.id2,
                      nickname: `User #${response.id2.toString().padStart(3, "0")}`,
                      avatarURL: `https://cdn2.thecatapi.com/images/${100 + response.id2}.jpg`,
                    };

                    onNewChat(user);
                  }

                  continue;
                }

                console.error(response);
                toast.error("Unknown error occurred!");
              } catch (error) {
                console.error(error);
              }
            }
          }, POLL_INTERVAL);

          setIntervalID(intervalID);
        } else {
          console.error(response);
          toast.error("Unknown error occurred!");
        }
      } catch (error) {
        console.error(error);
        toast.error("Unknown error occurred!");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webSocket]);

  useEffect(() => {
    const rawUsers = localStorage.getItem(userKey);
    const savedUsers: User[] = rawUsers !== null ? JSON.parse(rawUsers) : [];

    setUsers(savedUsers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketURL, clientID, receiver]);

  useEffect(() => {
    if (receiver === null) return;

    const rawMessages = localStorage.getItem(chatKey(receiver.id));
    const oldMessages: Message[] = rawMessages !== null ? JSON.parse(rawMessages) : [];

    setMessages(oldMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiver]);

  const onSendMessage = async (message: string) => {
    if (receiverRef.current === null) throw new Error("HOW");

    const packetKey = chatKey(receiverRef.current.id);
    const nonce = self.crypto.randomUUID();

    setMessages((oldMessages) => {
      const messages = [...oldMessages, { nonce, isSelf: true, content: message }];
      localStorage.setItem(packetKey, JSON.stringify(messages));

      return messages;
    });

    const setError = (error: string) =>
      setMessages((oldMessages) => {
        const messages = oldMessages.map((message) => (message.nonce === nonce ? { error, ...message } : message));
        localStorage.setItem(packetKey, JSON.stringify(messages));

        return messages;
      });

    try {
      const response = await sendPacket(DataPacket.push(clientIDRef.current, receiverRef.current.id, message));
      if (response.isControl() && response.isPositiveAck()) return;

      if (response.isControl() && response.isBufferFull()) {
        setError("Buffer full!");
        toast.error("Buffer full!");
      } else if (response.isManangement() && response.isUnknownError()) {
        setError("Message too long!");
        toast.error("Message too long!");
      } else {
        console.error(response);

        setError("Unknown error occurred!");
        toast.error("Unknown error occurred!");
      }
    } catch (error) {
      console.error(error);

      setError("Unknown error occurred!");
      toast.error("Unknown error occurred!");
    }
  };

  const onNewChat = (user: User) => {
    setUsers((oldUsers) => {
      const oldUser = oldUsers.find(({ id }) => user.id === id);
      if (oldUser !== undefined || user.id === clientIDRef.current) return oldUsers;

      const users = [user, ...oldUsers];
      localStorage.setItem(userKey, JSON.stringify(users));

      return users;
    });

    setIsNewOpen(false);
  };

  const onDeleteChat = (user: User) => {
    if (user.id === receiverRef.current?.id) {
      setReceiver(null);
      setMessages([]);
    }

    setUsers((oldUsers) => {
      const users = oldUsers.filter(({ id }) => id !== user.id);
      localStorage.setItem(userKey, JSON.stringify(users));

      return users;
    });

    localStorage.setItem(chatKey(user.id), JSON.stringify([]));
  };

  const onUpdateSettings = (settings: Settings) => {
    setSettings(settings);
    localStorage.setItem(settingsKey, JSON.stringify(settings));

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
            <div className="font-light italic text-xs">ID: {settings.clientID}</div>
            <div className="h-[570px]">
              <Command>
                <CommandInput placeholder="Search" />
                <CommandList>
                  <ScrollArea type="auto" className="h-[560px]">
                    <CommandEmpty>No chats found.</CommandEmpty>
                    <CommandGroup>
                      {users.map((user, index) => (
                        <CommandItem
                          selected={user.id == receiver?.id}
                          key={index}
                          className="cursor-pointer py-2"
                          onSelect={() => setReceiver(user)}
                        >
                          <UserAvatar user={user} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </ScrollArea>
                </CommandList>
              </Command>
            </div>
          </div>
          <div className="flex-1">
            {receiver === null ? (
              <></>
            ) : (
              <Chat
                receiver={receiver}
                messages={messages}
                onSendMessage={onSendMessage}
                onDeleteChat={() => onDeleteChat(receiver)}
                onEditChat={() => {}}
              />
            )}
          </div>
        </div>
      </div>
      <NewChat isOpen={isNewOpen} setIsOpen={setIsNewOpen} onCreate={onNewChat} />
      <Settings isOpen={isSettingsOpen} setIsOpen={setIsSettingsOpen} settings={settings} setSettings={onUpdateSettings} />
      <Toaster richColors />
    </ThemeProvider>
  );
}

export default App;
