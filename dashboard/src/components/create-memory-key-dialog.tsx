"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RETENTION_OPTIONS } from "@/lib/constants";
import { Plus } from "lucide-react";

export function CreateMemoryKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [retention, setRetention] = useState("90");

  const handleCreate = () => {
    // TODO: API call to create memory key
    setOpen(false);
    setName("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />New Key</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Memory Key</DialogTitle>
          <DialogDescription>Create a new isolated memory context for your application.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="key-name">Name (optional)</Label>
            <Input id="key-name" placeholder="customer-support-bot" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-xs text-muted-foreground">A friendly name to identify this memory context</p>
          </div>
          <div className="space-y-2">
            <Label>Retention</Label>
            <Select value={retention} onValueChange={setRetention}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RETENTION_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Memory is deleted after this period of inactivity</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate}>Create Key</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
