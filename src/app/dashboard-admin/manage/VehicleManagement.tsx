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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useFirebase } from '@/firebase';
import { doc, updateDoc, collection, addDoc, getDocs, orderBy, query, serverTimestamp, Timestamp, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Edit, Trash2, Wrench, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import type { FirestoreVehicle, MaintenanceRecord } from './page';

const vehicleEditSchema = z.object({
  model: z.string().min(1, 'Modelo é obrigatório'),
});

const maintenanceStartSchema = z.object({
  notes: z.string().optional(),
});

const vehicleCreateSchema = z.object({
  vehicleId: z.string().min(1, 'ID do Veículo (placa) é obrigatório'),
  model: z.string().min(1, 'Modelo é obrigatório'),
});

type VehicleEditForm = z.infer<typeof vehicleEditSchema>;
type MaintenanceStartForm = z.infer<typeof maintenanceStartSchema>;
type VehicleCreateForm = z.infer<typeof vehicleCreateSchema>;

interface VehicleManagementProps {
  vehicles: FirestoreVehicle[];
  activeRuns: { [key: string]: boolean };
  onDelete: (type: 'vehicle', id: string) => void;
  onUpdate: () => void;
  session: { companyId: string; sectorId: string };
}

export const VehicleManagement = ({ vehicles, activeRuns, onDelete, onUpdate, session }: VehicleManagementProps) => {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isMaintenanceDialogOpen, setIsMaintenanceDialogOpen] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);

  const [selectedVehicle, setSelectedVehicle] = useState<FirestoreVehicle | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [maintenanceHistory, setMaintenanceHistory] = useState<MaintenanceRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);


  const editForm = useForm<VehicleEditForm>({ resolver: zodResolver(vehicleEditSchema) });
  const maintenanceForm = useForm<MaintenanceStartForm>({ resolver: zodResolver(maintenanceStartSchema) });
  const createForm = useForm<VehicleCreateForm>({
    resolver: zodResolver(vehicleCreateSchema),
    defaultValues: { vehicleId: '', model: '' }
  });


  const handleEditClick = (vehicle: FirestoreVehicle) => {
    setSelectedVehicle(vehicle);
    editForm.reset({ model: vehicle.model });
    setIsEditDialogOpen(true);
  };
  
  const handleMaintenanceClick = (vehicle: FirestoreVehicle) => {
      setSelectedVehicle(vehicle);
      maintenanceForm.reset({ notes: '' });
      setIsMaintenanceDialogOpen(true);
  }
  
  const handleHistoryClick = async (vehicle: FirestoreVehicle) => {
    setSelectedVehicle(vehicle);
    setIsHistoryDialogOpen(true);
    setIsLoadingHistory(true);
    if (!firestore) return;
    try {
        const historyCol = collection(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/vehicles/${vehicle.id}/maintenance`);
        const q = query(historyCol, orderBy('startTime', 'desc'));
        const snapshot = await getDocs(q);
        const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaintenanceRecord));
        setMaintenanceHistory(history);
    } catch(error) {
        console.error("Error fetching maintenance history:", error);
        toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível carregar o histórico de manutenções.' });
    } finally {
        setIsLoadingHistory(false);
    }
  }

  const handleCreateSubmit = async (data: VehicleCreateForm) => {
    if (!firestore) return;
    setIsSubmitting(true);
    try {
        const vehicleRef = doc(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/vehicles`, data.vehicleId);
        await setDoc(vehicleRef, { 
            model: data.model, 
            isTruck: true, // Only trucks are managed here
            status: 'PARADO',
            imageUrl: ''
        });
        toast({ title: 'Sucesso', description: 'Caminhão cadastrado!' });
        onUpdate();
        setIsCreateDialogOpen(false);
    } catch (error: any) {
        console.error("Error creating vehicle:", error);
        toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível cadastrar o caminhão.' });
    } finally {
        setIsSubmitting(false);
    }
  }

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

  const handleMaintenanceSubmit = async (data: MaintenanceStartForm) => {
    if (!firestore || !selectedVehicle) return;
    setIsSubmitting(true);
    
    const vehicleRef = doc(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/vehicles`, selectedVehicle.id);

    try {
        // Iniciar Manutenção
        if (selectedVehicle.status === 'PARADO') {
            const maintenanceCol = collection(vehicleRef, 'maintenance');
            await addDoc(maintenanceCol, {
                startTime: serverTimestamp(),
                endTime: null,
                notes: data.notes || '',
            });
            await updateDoc(vehicleRef, { status: 'EM_MANUTENCAO' });
            toast({ title: 'Sucesso', description: `Manutenção iniciada para o veículo ${selectedVehicle.id}.` });
        }
        // Finalizar Manutenção
        else if (selectedVehicle.status === 'EM_MANUTENCAO') {
            const maintenanceCol = collection(vehicleRef, 'maintenance');
            const q = query(maintenanceCol, where('endTime', '==', null), orderBy('startTime', 'desc'));
            const openMaintenanceSnapshot = await getDocs(q);
            
            if (!openMaintenanceSnapshot.empty) {
                const maintenanceDoc = openMaintenanceSnapshot.docs[0];
                await updateDoc(maintenanceDoc.ref, { endTime: serverTimestamp() });
            }
            await updateDoc(vehicleRef, { status: 'PARADO' });
            toast({ title: 'Sucesso', description: `Manutenção finalizada para o veículo ${selectedVehicle.id}.` });
        }
        
        onUpdate();
        setIsMaintenanceDialogOpen(false);
    } catch (error) {
        console.error("Error handling maintenance:", error);
        toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível processar a solicitação de manutenção.' });
    } finally {
        setIsSubmitting(false);
    }
  }
  
  const getStatusBadge = (status: string | undefined, vehicleId: string) => {
      if (activeRuns[vehicleId]) {
          return <Badge variant="destructive">Em Corrida</Badge>;
      }
      switch (status) {
          case 'EM_MANUTENCAO':
              return <Badge className="bg-yellow-500 text-white">Manutenção</Badge>;
          case 'PARADO':
              return <Badge className="bg-green-500 text-white">Parado</Badge>;
          default:
              return <Badge variant="secondary">Indefinido</Badge>;
      }
  }
  
  const formatTimestamp = (timestamp: Timestamp | null): string => {
      if (!timestamp) return 'N/A';
      return format(timestamp.toDate(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  };
  
  const calculateDuration = (start: Timestamp | null, end: Timestamp | null): string => {
      if (!start) return 'N/A';
      const endDate = end ? end.toDate() : new Date();
      return formatDistanceToNow(start.toDate(), { locale: ptBR, addSuffix: false });
  };


  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => { createForm.reset(); setIsCreateDialogOpen(true); }}>Adicionar Caminhão</Button>
      </div>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Placa</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.map((vehicle) => (
              <TableRow key={vehicle.id}>
                <TableCell className="font-medium">{vehicle.id}</TableCell>
                <TableCell>{vehicle.model}</TableCell>
                <TableCell>{getStatusBadge(vehicle.status, vehicle.id)}</TableCell>
                <TableCell className="text-right space-x-1 sm:space-x-2">
                    <Button variant="outline" size="sm" onClick={() => handleHistoryClick(vehicle)}>
                        <History className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Histórico</span>
                    </Button>
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleMaintenanceClick(vehicle)}
                        disabled={!!activeRuns[vehicle.id]}
                        className={vehicle.status === 'EM_MANUTENCAO' ? 'border-yellow-500 text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20' : ''}
                    >
                        <Wrench className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Manutenção</span>
                    </Button>
                  <Button variant="outline" size="sm" onClick={() => handleEditClick(vehicle)}>
                    <Edit className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Editar</span>
                  </Button>
                  <AlertDialog>
                      <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm">
                              <Trash2 className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Deletar</span>
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

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Caminhão</DialogTitle>
            <DialogDescription>Altere o modelo do caminhão com a placa {selectedVehicle?.id}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="model">Modelo</Label>
              <Input id="model" {...editForm.register('model')} />
              {editForm.formState.errors.model && <p className="text-sm text-destructive mt-1">{editForm.formState.errors.model.message}</p>}
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
      
      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Adicionar Novo Caminhão</DialogTitle>
                  <DialogDescription>Preencha os dados para cadastrar um novo caminhão no setor.</DialogDescription>
              </DialogHeader>
              <form onSubmit={createForm.handleSubmit(handleCreateSubmit)} className="space-y-4">
                  <div>
                      <Label htmlFor="vehicleId">Placa do Caminhão</Label>
                      <Input id="vehicleId" {...createForm.register('vehicleId')} placeholder="ABC-1234"/>
                      {createForm.formState.errors.vehicleId && <p className="text-sm text-destructive mt-1">{createForm.formState.errors.vehicleId.message}</p>}
                  </div>
                  <div>
                      <Label htmlFor="modelCreate">Modelo do Caminhão</Label>
                      <Input id="modelCreate" {...createForm.register('model')} placeholder="Ex: VW Constellation"/>
                      {createForm.formState.errors.model && <p className="text-sm text-destructive mt-1">{createForm.formState.errors.model.message}</p>}
                  </div>
                   <DialogFooter>
                      <DialogClose asChild>
                          <Button type="button" variant="outline">Cancelar</Button>
                      </DialogClose>
                      <Button type="submit" disabled={isSubmitting}>
                          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Salvar
                      </Button>
                  </DialogFooter>
              </form>
          </DialogContent>
      </Dialog>

      {/* Maintenance Dialog */}
       <Dialog open={isMaintenanceDialogOpen} onOpenChange={setIsMaintenanceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedVehicle?.status === 'EM_MANUTENCAO' ? 'Finalizar Manutenção' : 'Iniciar Manutenção'}
            </DialogTitle>
            <DialogDescription>
              {selectedVehicle?.status === 'EM_MANUTENCAO'
                ? `Confirma a finalização da manutenção do veículo ${selectedVehicle?.id}?`
                : `Deseja colocar o veículo ${selectedVehicle?.id} em manutenção?`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={maintenanceForm.handleSubmit(handleMaintenanceSubmit)} className="space-y-4">
             {selectedVehicle?.status !== 'EM_MANUTENCAO' && (
                  <div>
                      <Label htmlFor="notes">Observações (Opcional)</Label>
                      <Textarea id="notes" {...maintenanceForm.register('notes')} placeholder="Descreva o motivo da manutenção..."/>
                  </div>
             )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancelar</Button>
              </DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {selectedVehicle?.status === 'EM_MANUTENCAO' ? 'Finalizar Manutenção' : 'Confirmar Início'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      
      {/* History Dialog */}
      <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Histórico de Manutenção - {selectedVehicle?.id}</DialogTitle>
            <DialogDescription>Lista de todas as manutenções realizadas neste veículo.</DialogDescription>
          </DialogHeader>
           <div className="max-h-[60vh] overflow-y-auto pr-4">
            {isLoadingHistory ? (
                 <div className="flex justify-center items-center h-40"><Loader2 className="h-8 w-8 animate-spin"/></div>
            ) : maintenanceHistory.length > 0 ? (
                 <div className="space-y-4">
                    {maintenanceHistory.map(record => (
                        <div key={record.id} className="border p-4 rounded-md bg-muted/50">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="font-semibold">Início: <span className="font-normal">{formatTimestamp(record.startTime)}</span></p>
                                    <p className="font-semibold">Fim: <span className="font-normal">{formatTimestamp(record.endTime)}</span></p>
                                </div>
                                <Badge variant={record.endTime ? 'secondary' : 'default'} className={!record.endTime ? 'bg-yellow-500' : ''}>
                                    {record.endTime ? `Duração: ${calculateDuration(record.startTime, record.endTime)}` : 'Em andamento'}
                                </Badge>
                            </div>
                            {record.notes && <p className="text-sm text-muted-foreground mt-2 border-t pt-2"><strong>Observações:</strong> {record.notes}</p>}
                        </div>
                    ))}
                 </div>
            ) : (
                <p className="text-center text-muted-foreground py-8">Nenhum registro de manutenção encontrado.</p>
            )}
           </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
