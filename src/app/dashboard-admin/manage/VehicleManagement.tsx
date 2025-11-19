
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Edit, Trash2 } from 'lucide-react';
import type { FirestoreVehicle } from './page';

const vehicleEditSchema = z.object({
  model: z.string().min(1, 'Modelo é obrigatório'),
});

type VehicleEditForm = z.infer<typeof vehicleEditSchema>;

interface VehicleManagementProps {
  vehicles: FirestoreVehicle[];
  onDelete: (type: 'vehicle', id: string) => void;
  onUpdate: () => void;
  session: { companyId: string; sectorId: string };
}

export const VehicleManagement = ({ vehicles, onDelete, onUpdate, session }: VehicleManagementProps) => {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<FirestoreVehicle | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<VehicleEditForm>({
    resolver: zodResolver(vehicleEditSchema),
  });

  const handleEditClick = (vehicle: FirestoreVehicle) => {
    setSelectedVehicle(vehicle);
    reset({ model: vehicle.model });
    setIsEditDialogOpen(true);
  };

  const handleEditSubmit = async (data: VehicleEditForm) => {
    if (!firestore || !selectedVehicle) return;
    setIsSubmitting(true);
    try {
      const vehicleRef = doc(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/vehicles`, selectedVehicle.id);
      await updateDoc(vehicleRef, { model: data.model });
      toast({ title: 'Sucesso', description: 'Veículo atualizado.' });
      onUpdate();
      setIsEditDialogOpen(false);
    } catch (error) {
      console.error("Error updating vehicle:", error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível atualizar o veículo.' });
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
              <TableHead>Placa</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.map((vehicle) => (
              <TableRow key={vehicle.id}>
                <TableCell className="font-medium">{vehicle.id}</TableCell>
                <TableCell>{vehicle.model}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="outline" size="sm" onClick={() => handleEditClick(vehicle)}>
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
                                  Essa ação não pode ser desfeita. Isso irá deletar permanentemente o caminhão com a placa "{vehicle.id}".
                              </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onDelete('vehicle', vehicle.id)}>
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
            <DialogTitle>Editar Caminhão</DialogTitle>
            <DialogDescription>Altere o modelo do caminhão com a placa {selectedVehicle?.id}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(handleEditSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="model">Modelo</Label>
              <Input id="model" {...register('model')} />
              {errors.model && <p className="text-sm text-destructive mt-1">{errors.model.message}</p>}
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
