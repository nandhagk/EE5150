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
interface Callback{
    resolve: (p: Packet) => void,
    reject: () => void,
}


function App(){
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
      
    const { clientID, socketURL, pollInterval } = settings;
    const { readyState, lastMessage, sendMessage } = useWebSocket(socketURL, { disableJson: true });
    
    const [chatHistory, setChatHistory] = useState<Map<number, Message[]>>(new Map<number, Message[]>());
    
    const [users, setUsers] = useState<User[]>([]);
    const [receiver, setReceiver] = useState<User | null>(null);
    
    const userKey = () => {return `${socketURL}|${clientID}|users`};
    const chatKey = () => {return `${socketURL}|${clientID}|chats`};
    
    const [isNewOpen, setIsNewOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    
    const [callbacks, setCallbacks] = useState<Callback[]>([]);

	const [associated, setAsssociated] = useState<boolean>(false);

    const send = (message: Packet) => { // Sends a message
        const promise = new Promise<Packet>((resolve, reject) => {
            setCallbacks([...callbacks, {resolve, reject}]);
        });
        sendMessage(message.encode())
        return promise;
    }

    const process = async (data: Blob) => { // Just resolves the required promise
        const buffer = await data.arrayBuffer();
        
        const {resolve, reject} = callbacks.shift()!;
        const packet = Packet.decode(buffer);
        if (packet === null){
            reject();
        } else{
            resolve(packet);
        }
    };
    useEffect(() => { // On recieve
        if (readyState !== ReadyState.OPEN || lastMessage === null) return;
        
        process(lastMessage.data)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastMessage]);
    
    useEffect(() => { // Clear remaining promises on connect/reconnect
        if (readyState !== ReadyState.OPEN){
            while (callbacks.length > 0){
              callbacks.pop()?.reject();
            }
        }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readyState]);
      
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

		//console.log(rawChat, savedUsers);

        setChatHistory(savedChat);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socketURL, clientID]);
    
    // useEffect(() => { // Save chat when it changes 
    //     if (receiver === null) return;
    //     localStorage.setItem(chatKey(), JSON.stringify([...chatHistory.entries()]));
    // // eslint-disable-next-line react-hooks/exhaustive-deps
    // }, [chatHistory])
    
    useEffect(() => setReceiver(null), [socketURL, clientID]); // Clear reciever when user changes
    
    useEffect(() => { // When a new connection is established
		if (readyState !== ReadyState.OPEN) return;
		
        let intervalID: NodeJS.Timeout | null = null;
        
        send(ManagementPacket.associate(clientID)).then(
            (response: Packet) => {            
                if (response.isManangement() && response.isAssociationSuccess()){
                    setAsssociated(true);
                }                      
            // TODO: Error state
          }      
        )
        return () => void (intervalID !== null && clearInterval(intervalID));    
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [readyState]);

	  useEffect(() => {
		
	  }, [settings, associated]);
    
      
    const onSendMessage = (message: string) => { // When a message is to be sent
        if (receiver === null) return;
    
        send(DataPacket.push(clientID, receiver.id, message)).then(
            (response: Packet) => {
                if (response.isControl() && response.isBufferFull()){
                // TODO: Error state
                // on error undo the below code! (Or consider adding that exclamation mark business)
                }
            }
        )    
        
        const oldMessages: Message[] = chatHistory.get(receiver.id) !== undefined ? chatHistory.get(receiver.id)! : [];
        const newMessages = [...oldMessages, { isSelf: true, content: message }];        

        setChatHistory(new Map(chatHistory.set(receiver.id, newMessages)));
    };
    
    const onNewChat = (user: User) => { // When a new chat is created
        const newUsers = [user, ...users];

        setUsers(newUsers);
        localStorage.setItem(userKey(), JSON.stringify(newUsers));

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
                <div className="h-[600px]">
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
              <div className="flex-1">{receiver === null ? <></> : <Chat receiver={receiver} messages={chatHistory.get(receiver.id) ? chatHistory.get(receiver.id)! : []} onSendMessage={onSendMessage} />}</div>
            </div>
          </div>
          <NewChat isOpen={isNewOpen} setIsOpen={setIsNewOpen} onCreate={onNewChat} />
          <Settings isOpen={isSettingsOpen} setIsOpen={setIsSettingsOpen} settings={settings} setSettings={onUpdateSettings} />
        </ThemeProvider>
    );
}
export default App;