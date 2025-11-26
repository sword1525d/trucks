'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useFirebase } from '@/firebase';
import { collection, addDoc, serverTimestamp, getDocs, query, where, Timestamp } from 'firebase/firestore';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

type ChecklistItem = {
  id: string;
  location: string;
  title: string;
  description: string;
  status: 'conforme' | 'nao_conforme' | 'na';
};

const CHECKLIST_ITEMS: Omit<ChecklistItem, 'status'>[] = [
    { id: '1', location: 'D', title: 'Teto das carrocerias', description: 'Verificar se não possuem vazamentos.' },
    { id: '2', location: 'C', title: 'Piso do baú (Assoalho)', description: 'Deve estar sem depreciações, sem furos ou afundamentos ou algo que gere dificuldade da movimentação de carrinhos.' },
    { id: '3', location: 'B', title: 'Escada de acesso a cabine. Escada caminhão químico', description: 'Checar se estão em condição segura de acesso.' },
    { id: '4', location: 'B', title: 'Farois, Lanternas e Sinalizadores', description: 'Checar se estão obedecendo os comandos quando acionados.' },
    { id: '5', location: 'B', title: 'Sinalizadores sonoros', description: 'Checar se estão obedecendo os comandos quando acionados.' },
    { id: '6', location: 'A', title: 'Portas (Cabine / Taipau / Baú)', description: 'As portas devem abrir e fechar com facilidade.' },
    { id: '7', location: 'B', title: 'Alavancas (Marcha / Seta )', description: 'Checar se há folgas ou impedimento do uso.' },
    { id: '8', location: 'C', title: 'Painel de instrumentos', description: 'Velocímetro - deve está funcionando. Combustível - Acima de 1/4.' },
    { id: '9', location: 'A', title: 'Sistema de direção', description: 'Checar se há dificuldades com manobras. Nível do óleo hidráulico.' },
    { id: '10', location: 'A', title: 'Freios (Pedal / Estacionamento)', description: 'Checar se estão obedecendo os comandos quando acionados.' },
    { id: '11', location: 'B', title: 'Corda de amarração', description: 'Devem estar em ótimo estado de uso' },
    { id: '12', location: 'B', title: 'Corrente Contenção', description: 'Deve conter 2 unidades dentro do baú do caminhão.' },
    { id: '13', location: 'B', title: 'Cinta de Amarração', description: 'Mínimo 2 unidades. Devem estar em ótimas condições.' },
    { id: '14', location: 'B', title: 'Corrente de Ancoragem', description: 'Deve conter no mínimo 02 pares.' },
    { id: '15', location: 'A', title: 'Calços', description: 'Deve conter no mínimo 02 unidades.' },
    { id: '16', location: 'A', title: 'Pneus (Dianteiros / Traseiros)', description: 'Checar se estão em perfeitas condições de uso.' },
    { id: '17', location: 'A', title: 'Extintor de Incêndio', description: 'Deve estar disponível, válido( seta de pressão no verde), de fácil acesso.' },
    { id: '18', location: 'C', title: 'Outros apontamentos', description: 'Se houver apontamentos inserir "NC" se não houver inserir "C".' }
];

type Vehicle = {
  id: string;
  model: string;
};

type UserData = {
  id: string;
  name: string;
  companyId: string;
  sectorId: string;
};

export default function ChecklistPage() {
  const router = useRouter();
  const { firestore, user: authUser } = useFirebase();
  const { toast } = useToast();

  const [user, setUser] = useState<UserData | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    CHECKLIST_ITEMS.map(item => ({ ...item, status: 'na' }))
  );
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const companyId = localStorage.getItem('companyId');
    const sectorId = localStorage.getItem('sectorId');

    if (storedUser && companyId && sectorId && authUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser({ ...parsedUser, id: authUser.uid, companyId, sectorId });
    } else if (!authUser && !isLoading) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Sessão inválida. Faça login novamente.',
      });
      router.push('/login');
    }
  }, [router, toast, authUser, isLoading]);

  useEffect(() => {
    if (!firestore || !user) return;

    const fetchVehicles = async () => {
      try {
        const vehiclesCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/vehicles`);
        const q = query(vehiclesCol, where('isTruck', '==', true));
        const querySnapshot = await getDocs(q);
        const vehiclesList = querySnapshot.docs.map(doc => ({ id: doc.id, model: doc.data().model }));
        setVehicles(vehiclesList);
      } catch (error) {
        toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível carregar os veículos.' });
      } finally {
        setIsLoading(false);
      }
    };
    fetchVehicles();
  }, [firestore, user, toast]);

  const handleStatusChange = (itemId: string, status: 'conforme' | 'nao_conforme' | 'na') => {
    setChecklist(prev =>
      prev.map(item => (item.id === itemId ? { ...item, status } : item))
    );
  };
  
  const handleSaveChecklist = async () => {
      if (!selectedVehicle) {
          toast({ variant: 'destructive', title: 'Erro', description: 'Por favor, selecione um veículo.' });
          return;
      }
      
      const isAllChecked = checklist.every(item => item.status !== 'na');
      if (!isAllChecked) {
           toast({ variant: 'destructive', title: 'Erro', description: 'Por favor, preencha todos os itens do checklist.' });
           return;
      }

      setIsSubmitting(true);
      if(!firestore || !user) return;

      try {
          const checklistCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/vehicles/${selectedVehicle}/checklists`);
          await addDoc(checklistCol, {
              vehicleId: selectedVehicle,
              driverId: user.id,
              driverName: user.name,
              timestamp: serverTimestamp(),
              items: checklist,
          });

          toast({ title: 'Sucesso!', description: 'Checklist salvo com sucesso.' });
          router.push('/dashboard-truck');

      } catch (error) {
          console.error("Erro ao salvar checklist:", error);
          toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível salvar o checklist.' });
      } finally {
          setIsSubmitting(false);
      }
  }

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-black">
      <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 container mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" onClick={() => router.push('/dashboard-truck')}>
                    <ArrowLeft />
                </Button>
                <h1 className="text-2xl font-bold">Checklist Diário</h1>
            </div>
            <Dialog>
                <DialogTrigger asChild>
                    <Button variant="outline">Ver Croqui</Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Croqui do Caminhão</DialogTitle>
                    </DialogHeader>
                    <div className="max-h-[80vh] overflow-y-auto">
                        <Image src="/mapacaminhao.png" alt="Croqui do Caminhão" width={800} height={1200} className="w-full h-auto" />
                    </div>
                </DialogContent>
            </Dialog>
        </div>

        <Card>
            <CardHeader>
                <CardTitle>Seleção do Veículo</CardTitle>
                <CardDescription>Escolha o caminhão para realizar a inspeção.</CardDescription>
            </CardHeader>
            <CardContent>
                 <Select value={selectedVehicle} onValueChange={setSelectedVehicle} disabled={isLoading}>
                    <SelectTrigger>
                    <SelectValue placeholder={isLoading ? "Carregando..." : "Selecione um veículo"} />
                    </SelectTrigger>
                    <SelectContent>
                    {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{`${v.id} - ${v.model}`}</SelectItem>)}
                    </SelectContent>
                </Select>
            </CardContent>
        </Card>
        
        <Separator />

        <div className="space-y-4">
          {checklist.map(item => (
            <Card key={item.id} className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                  <div className="flex-1">
                    <p className="font-semibold text-base">
                        <span className="inline-flex items-center justify-center bg-primary text-primary-foreground rounded-full h-6 w-6 mr-2 text-xs">{item.id}</span>
                        {item.title}
                        <span className="ml-2 text-xs font-mono text-muted-foreground bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">[{item.location}]</span>
                    </p>
                    <p className="text-sm text-muted-foreground ml-8">{item.description}</p>
                  </div>
                  <RadioGroup
                    defaultValue="na"
                    onValueChange={(value: 'conforme' | 'nao_conforme' | 'na') => handleStatusChange(item.id, value)}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="conforme" id={`c-${item.id}`} />
                      <Label htmlFor={`c-${item.id}`} className="cursor-pointer">Conforme</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="nao_conforme" id={`nc-${item.id}`} />
                      <Label htmlFor={`nc-${item.id}`} className="cursor-pointer">Não Conforme</Label>
                    </div>
                  </RadioGroup>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

      <footer className="sticky bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-sm border-t">
        <div className="container mx-auto max-w-4xl">
          <Button
            className="w-full text-lg h-14"
            onClick={handleSaveChecklist}
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar Checklist
          </Button>
        </div>
      </footer>
    </div>
  );
}
