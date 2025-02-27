import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export interface User {
  id: number;
  nickname: string;
  avatarURL: string;
}


export interface UserAvatarProps {
  user: User;
}

export function UserAvatar({ user }: UserAvatarProps) {
  const { id, nickname, avatarURL } = user;

  return (
    <div className="flex items-center space-x-4">
      <Avatar>
        <AvatarImage src={avatarURL} alt="Image" />
        <AvatarFallback>{id.toString().padStart(3, "0")}</AvatarFallback>
      </Avatar>
      <div>
        <p className="text-sm font-medium leading-none">{nickname}</p>
        <p className="text-sm text-muted-foreground">#{id.toString().padStart(3, "0")}</p>
      </div>
    </div>
  );
}
