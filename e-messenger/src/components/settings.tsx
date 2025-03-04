import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const formSchema = z.object({
  clientID: z.coerce.number(),
  socketURL: z.string().url(),
});

export interface Settings {
  clientID: number;
  socketURL: string;
}

export interface SettingsProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  settings: Settings;
  setSettings: (settings: Settings) => void;
}

export function Settings({ isOpen, setIsOpen, settings, setSettings }: SettingsProps) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: settings,
  });

  useEffect(() => {
    form.setValue("clientID", settings.clientID);
    form.setValue("socketURL", settings.socketURL);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Set your preferences.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(setSettings)} className="space-y-8">
            <FormField
              control={form.control}
              name="clientID"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client ID</FormLabel>
                  <FormControl>
                    <Input
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      type="number"
                      placeholder="Client ID"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="socketURL"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Server URL</FormLabel>
                  <FormControl>
                    <Input placeholder="Server URL" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button className="cursor-pointer" type="submit">
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
