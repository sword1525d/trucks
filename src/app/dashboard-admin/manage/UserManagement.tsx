
'use client';
import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Edit, Trash2 } from 'lucide-react';
import type { FirestoreUser } from './page';

const TURNOS = {
    PRIMEIRO_NORMAL: '1° NORMAL',
    SEGUNDO_NORMAL: '2° NORMAL',
    PRIMEIRO_ESPECIAL: '1° ESPECIAL',
    SEGUNDO_ESPECIAL: '2° ESPECIAL'
};

const userEditSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  isAdmin: z.boolean(),
  truck: z.boolean(),
  shift: z.string().min(1, 'O turno é obrigatório'),
});

type UserEditForm = z.infer<typeof userEditSchema>;

interface UserManagementProps {
  users: FirestoreUser[];
  onDelete: (type: 'user', id: string) => void;
  onUpdate: () => void;
  session: { companyId: string; sectorId: string };
}

export const UserManagement = ({ users, onDelete, onUpdate, session }: UserManagementProps) => {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<FirestoreUser | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { control, register, handleSubmit, reset, formState: { errors } } = useForm<UserEditForm>({
    resolver: zodResolver(userEditSchema),
  });

  const handleEditClick = (user: FirestoreUser) => {
    setSelectedUser(user);
    reset({
      name: user.name,
      isAdmin: user.isAdmin,
      truck: user.truck,
      shift: user.shift || '',
    });
    setIsEditDialogOpen(true);
  };

  const handleEditSubmit = async (data: UserEditForm) => {
    if (!firestore || !selectedUser) return;
    setIsSubmitting(true);
    try {
      const userRef = doc(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/users`, selectedUser.id);
      await updateDoc(userRef, {
        name: data.name.toUpperCase(),
        isAdmin: data.isAdmin,
        truck: data.truck,
        shift: data.shift,
      });
      toast({ title: 'Sucesso', description: 'Usuário atualizado.' });
      onUpdate();
      setIsEditDialogOpen(false);
    } catch (error) {
      console.error("Error updating user:", error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível atualizar o usuário.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Turno</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Motorista</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.shift || 'N/A'}</TableCell>
                <TableCell>{user.isAdmin ? 'Sim' : 'Não'}</TableCell>
                <TableCell>{user.truck ? 'Sim' : 'Não'}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="outline" size="sm" onClick={() => handleEditClick(user)}>
                    <Edit className="h-4 w-4 mr-1" /> Editar
                  </Button>
                   <AlertDialog>
                      <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm">
                              <Trash2 className="h-4 w-4 mr-1" /> Deletar
                          </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                          <AlertDialogHeader>
                              <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                              <AlertDialogDescription>
                                  Essa ação não pode ser desfeita. Isso irá deletar permanentemente o usuário "{user.name}".
                              </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onDelete('user', user.id)}>
                                  Confirmar
                              </AlertDialogAction>
                          </AlertDialogFooter>
                      </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription>Altere os dados do usuário {selectedUser?.name}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(handleEditSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="name">Nome</Label>
              <Input id="name" {...register('name')} />
              {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
            </div>
            
            <div>
                <Label htmlFor="shift">Turno</Label>
                 <Controller
                    name="shift"
                    control={control}
                    render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value || ''}>
                            <SelectTrigger id="shift">
                                <SelectValue placeholder="Selecione o Turno" />
                            </SelectTrigger>
                            <SelectContent>
                                 {Object.values(TURNOS).map(turno => <SelectItem key={turno} value={turno}>{turno}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                />
                 {errors.shift && <p className="text-sm text-destructive mt-1">{errors.shift.message}</p>}
            </div>

            <div className="flex items-center space-x-2">
              <Controller
                name="isAdmin"
                control={control}
                render={({ field }) => (
                  <Switch id="isAdmin" checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
              <Label htmlFor="isAdmin">É Administrador?</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Controller
                name="truck"
                control={control}
                render={({ field }) => (
                  <Switch id="truck" checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
              <Label htmlFor="truck">É Motorista de Caminhão?</Label>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancelar</Button>
              </DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar Alterações
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

    