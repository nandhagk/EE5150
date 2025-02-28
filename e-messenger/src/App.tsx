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
interface Callback {
  resolve: (p: Packet) => void,
  reject: () => void,
}

function deepCopyChat(chatHistory: Map<number, Message[]>) {
  const copy = new Map<number, Message[]>(
    JSON.parse(JSON.stringify([...chatHistory.entries()]))
  );
  // chatHistory.forEach((value, key) => {
  // 	copy.set(key, [...value]);
  // });
  return copy;
}


function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const { readyState, lastMessage, sendMessage } = useWebSocket(settings.socketURL, { disableJson: true, share: false, retryOnError: false });

  const [chatHistory, setChatHistory] = useState<Map<number, Message[]>>(new Map<number, Message[]>());

  const [users, setUsers] = useState<User[]>([]);
  const [receiver, setReceiver] = useState<User | null>(null);

  const userKey = () => { return `${settings.socketURL}|${settings.clientID}|users` };
  const chatKey = () => { return `${settings.socketURL}|${settings.clientID}|chats` };

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [callbacks, setCallbacks] = useState<Callback[]>([]);


  const send = (message: Packet) => { // Sends a message
    console.log(message);
    const promise = new Promise<Packet>((resolve, reject) => {
      setCallbacks([...callbacks, { resolve, reject }]);
    });
    sendMessage(message.encode())
    return promise;
  }

  const process = async (data: Blob) => { // Just resolves the required promise
    const buffer = await data.arrayBuffer();

    const { resolve, reject } = callbacks.shift()!;
    const packet = Packet.decode(buffer);
    if (packet === null) {
      reject();
    } else {
      resolve(packet);
    }
  };
  useEffect(() => { // On recieve
    if (readyState !== ReadyState.OPEN || lastMessage === null) return;
    setTimeout(() => process(lastMessage.data), 100);
    // process(lastMessage.data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage]);

  useEffect(() => { // Clear remaining promises on connect/reconnect
    if (readyState !== ReadyState.OPEN) {
      while (callbacks.length > 0) {
        callbacks.pop()?.reject();
      }
      return;
    }
    let intervalID: NodeJS.Timeout | null = null;
    console.log(settings);
    send(ManagementPacket.associate(settings.clientID)).then(
      (response: Packet) => {
        if (
          response.isManangement()
          // && response.isAssociationSuccess()
        ) {
          intervalID = setInterval(async () => {
            let gotEmpty = false;
            while (!gotEmpty) {
              const response = await send(ControlPacket.get(settings.clientID));

              if (response.isData() && response.isGetResponse()) {
                setChatHistory((history) => {
                  const oldMessages: Message[] = history.get(response.id2) !== undefined ? history.get(response.id2)! : [];
                  console.log("GET", history.get(response.id2), history);
                  const newMessages = [...oldMessages, { isSelf: false, content: response.payload }];
                  const result = (deepCopyChat(history.set(response.id2, newMessages)));
                  localStorage.setItem(chatKey(), JSON.stringify([...result.entries()]));
                  return result;
                });

                if (users.find(({ id }) => id === response.id2) === undefined)
                  onNewChat({
                    id: response.id2,
                    nickname: `User #${response.id2.toString().padStart(3, "0")}`,
                    avatarURL: `https://cdn2.thecatapi.com/images/${100 + response.id2}.jpg`,
                  });
              } else{
                gotEmpty = true;
              }
            }
          }, settings.pollInterval) // TODO: Error state

        }
      }
    );
    return () => void (intervalID !== null && clearInterval(intervalID));
          // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyState, settings]);

useEffect(() => { // Sets the settings
  const rawSettings = localStorage.getItem("settings");
  const oldSettings: Settings = rawSettings !== null ? JSON.parse(rawSettings) : DEFAULT_SETTINGS;

  setSettings(oldSettings);
}, []);

const onUpdateSettings = (newSettings: Settings) => {
  setSettings(newSettings);
  localStorage.setItem("settings", JSON.stringify(newSettings));

  setIsSettingsOpen(false);
};

useEffect(() => { // When the user changes his ID
  const rawUsers = localStorage.getItem(userKey());
  const savedUsers: User[] = rawUsers !== null ? JSON.parse(rawUsers) : [];

  setUsers(savedUsers);

  const rawChat = localStorage.getItem(chatKey());
  const savedChat = new Map<number, Message[]>(rawChat !== null ? JSON.parse(rawChat) : []);



  setChatHistory(savedChat);

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [settings.socketURL, settings.clientID]);


useEffect(() => { setReceiver(null); }, [settings.socketURL, settings.clientID]); // Clear reciever when user changes

const onSendMessage = (message: string) => { // When a message is to be sent
  if (receiver === null) return;

  send(DataPacket.push(settings.clientID, receiver.id, message)).then(
    (response: Packet) => {
      if (response.isControl() && response.isBufferFull()) {
        // TODO: Error state
        // on error undo the below code! (Or consider adding that exclamation mark business)
      }
    }
  )

  let done = false;
  setChatHistory((history) => {
    if (done) return history;
    done = true;
    const oldMessages: Message[] = history.get(receiver.id) !== undefined ? history.get(receiver.id)! : [];
    const newMessages = [...oldMessages, { isSelf: true, content: message }];
    console.log(newMessages)
    const result = (deepCopyChat(history.set(receiver.id, newMessages)));
    localStorage.setItem(chatKey(), JSON.stringify([...result.entries()]));
    return result;

  })
};

const onDeleteChat = (user: User) => {

  setUsers((userss) => {
    const newUsers = userss.filter((v) => v.id != user.id)
    localStorage.setItem(userKey(), JSON.stringify(newUsers));
    return newUsers;
  });

  setReceiver(null);

  setChatHistory((history) => {

    const result = (deepCopyChat(history));
    result.delete(user.id)
    localStorage.setItem(chatKey(), JSON.stringify([...result.entries()]));
    return result;

  });
};

const onNewChat = (user: User) => { // When a new chat is created


  setUsers((userss) => {
    const newUsers = [user, ...userss]
    localStorage.setItem(userKey(), JSON.stringify(newUsers));
    return newUsers;
  });

  setIsNewOpen(false);
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
                      <CommandItem key={index} className="cursor-pointer py-2" onSelect={() => setReceiver(user)}>
                        <UserAvatar user={user} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </ScrollArea>
              </CommandList>
            </Command>
          </div>
        </div>
        <div className="flex-1">{receiver === null ? <></> : <Chat onEditChat={() => { }} onDeleteChat={onDeleteChat} receiver={receiver} messages={chatHistory.get(receiver.id) ? chatHistory.get(receiver.id)! : []} onSendMessage={onSendMessage} />}</div>
      </div>
    </div>
    <NewChat isOpen={isNewOpen} setIsOpen={setIsNewOpen} onCreate={onNewChat} />
    <Settings isOpen={isSettingsOpen} setIsOpen={setIsSettingsOpen} settings={settings} setSettings={onUpdateSettings} />
  </ThemeProvider>
);
}
export default App;