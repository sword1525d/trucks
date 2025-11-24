'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFirebase } from '@/firebase';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

type UserData = {
  id: string;
  name: string;
  companyId: string;
  sectorId: string;
};

type Vehicle = {
  id: string;
  model: string;
};

type StopPoint = string;

const PREDEFINED_STOP_POINTS: StopPoint[] = [
  "PINT. ABS", "PINT. FX ABS", "MOCOM", "INJ. PLÁSTICA", "PINT. PÓ", "USINAGEM", "PINT. TANQUE", "PINT. ALUMÍNIO",
  "MONT. RODA", "SOLDA CHASSI", "DIV. PEÇAS", "GALVANOPLASTIA", "DOBRADETUBOS", "ESTAM. PRENSA", "MONT. MOTOR", "SOLDA ESCAP.",
  "LINHA MONT.", "PINT. ALT. TEMP.", "SOLDA TANQUE", "FUNDIÇÃO", "SOLDA COMP.", "FÁBR. ASSENTO", "MONT. QUADRI.", "MONT. FILTRO",
  "SOLDA ALUMÍNIO", "FABRICA DE ARO", "MOCOMMSIN1", "PRENSA. COMP."
];

export default function TruckRunPage() {
  const router = useRouter();
  const { firestore, user: authUser } = useFirebase();
  const { toast } = useToast();

  const [user, setUser] = useState<UserData | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [mileage, setMileage] = useState('');
  const [stopPoint, setStopPoint] = useState<StopPoint>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const companyId = localStorage.getItem('companyId');
    const sectorId = localStorage.getItem('sectorId');

    if (storedUser && companyId && sectorId && authUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser({ ...parsedUser, id: authUser.uid, companyId, sectorId });
    } else if (!authUser && !isLoading) { // only redirect if auth is settled
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
        const querySnapshot = await getDocs(vehiclesCol);
        const vehiclesList = querySnapshot.docs
          .map(doc => ({ id: doc.id, ...(doc.data() as any) }))
          .filter(v => v.isTruck)
          .map(v => ({ id: v.id, model: v.model }));
        setVehicles(vehiclesList);
      } catch (error) {
        toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível carregar os veículos.' });
      } finally {
        setIsLoading(false);
      }
    };
    fetchVehicles();
  }, [firestore, user, toast]);

  const handleStartRun = async () => {
    if(!firestore || !user || !selectedVehicle || !mileage || !stopPoint){
       toast({ variant: 'destructive', title: 'Erro', description: 'Preencha todos os campos para iniciar a corrida.' });
       return;
    }
    setIsSubmitting(true);
    try {
      const runsCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/runs`);
      const newRun = {
        driverId: user.id,
        driverName: user.name,
        vehicleId: selectedVehicle,
        startMileage: Number(mileage),
        startTime: serverTimestamp(),
        status: 'IN_PROGRESS',
        stops: [{
          name: stopPoint,
          status: 'PENDING',
          arrivalTime: null,
          departureTime: null,
          collectedOccupiedCars: null,
          collectedEmptyCars: null,
          mileageAtStop: null,
          occupancy: null,
        }],
        endTime: null,
        endMileage: null,
      };
      
      const docRef = await addDoc(runsCol, newRun);

      toast({ title: 'Sucesso', description: 'Acompanhamento iniciado! Redirecionando...' });
      
      router.push(`/dashboard-truck/active-run?id=${docRef.id}`);

    } catch(error) {
       console.error("Erro ao iniciar corrida: ", error);
       toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível iniciar o acompanhamento.' });
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
      <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto container mx-auto max-w-2xl">
        
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => router.push('/dashboard-truck')}>
            <ArrowLeft />
          </Button>
          <h1 className="text-2xl font-bold">Iniciar Acompanhamento</h1>
        </div>
        
        <section>
          <h2 className="text-xl font-semibold text-foreground mb-4">Informações da Corrida</h2>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="veiculo">Veículo</Label>
              <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
                <SelectTrigger id="veiculo">
                  <SelectValue placeholder="Selecione um veículo" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{`${v.id} - ${v.model}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="quilometragem">Quilometragem Atual</Label>
              <Input id="quilometragem" type="number" placeholder="KM atual do veículo" value={mileage} onChange={e => setMileage(e.target.value)} />
            </div>
          </div>
        </section>

        <Separator />

        <section>
           <h2 className="text-xl font-semibold text-foreground mb-4">Destino</h2>
            <div className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="stop-point">Ponto de Parada</Label>
                  <Select value={stopPoint} onValueChange={setStopPoint}>
                    <SelectTrigger id="stop-point">
                      <SelectValue placeholder="Selecione o destino da corrida" />
                    </SelectTrigger>
                    <SelectContent>
                      {PREDEFINED_STOP_POINTS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
            </div>
        </section>

        <div className="h-24"></div>
      </main>

        <footer className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-sm border-t">
           <div className="container mx-auto max-w-2xl">
              <Button 
                className="w-full text-lg h-14" 
                onClick={handleStartRun}
                disabled={!selectedVehicle || !mileage || !stopPoint || isSubmitting}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                INICIAR ACOMPANHAMENTO
              </Button>
           </div>
        </footer>
    </div>
  );
}
