
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useFirebase } from '@/firebase';
import { collection, getDocs, doc, deleteDoc, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Loader2, User, Truck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserManagement } from './UserManagement';
import { VehicleManagement } from './VehicleManagement';

export type FirestoreUser = {
  id: string;
  name: string;
  truck: boolean;
  isAdmin: boolean;
  matricula: string;
  shift?: string;
};

export type VehicleStatusEnum = 'PARADO' | 'EM_CORRIDA' | 'EM_MANUTENCAO';

export type FirestoreVehicle = {
  id: string;
  model: string;
  isTruck: boolean;
  status: VehicleStatusEnum;
};

export type MaintenanceRecord = {
    id: string;
    startTime: Timestamp;
    endTime: Timestamp | null;
    notes?: string;
}

type SessionData = {
  companyId: string;
  sectorId: string;
};

const AdminManagementPage = () => {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  
  const [session, setSession] = useState<SessionData | null>(null);
  const [users, setUsers] = useState<FirestoreUser[]>([]);
  const [vehicles, setVehicles] = useState<FirestoreVehicle[]>([]);
  const [activeRuns, setActiveRuns] = useState<{ [key: string]: boolean }>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const companyId = localStorage.getItem('companyId');
    const sectorId = localStorage.getItem('sectorId');

    if (companyId && sectorId) {
      setSession({ companyId, sectorId });
    } else {
      toast({ variant: 'destructive', title: 'Sessão inválida', description: 'Faça login novamente.' });
      router.push('/login');
    }
  }, [router, toast]);
  
  const fetchData = useCallback(async () => {
    if (!firestore || !session) return;

    setIsLoading(true);
    try {
        const usersCol = collection(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/users`);
        const usersSnapshot = await getDocs(usersCol);
        const userList = usersSnapshot.docs.map(doc => {
            const data = doc.data();
             return {
                id: doc.id,
                name: data.name,
                truck: data.truck,
                isAdmin: data.isAdmin,
                matricula: 'N/A', // Placeholder - Ideally this is stored in the doc
                shift: data.shift
            } as FirestoreUser
        });
        setUsers(userList);

    } catch (error) {
        console.error("Error fetching data: ", error);
        toast({ variant: 'destructive', title: 'Erro ao carregar dados', description: 'Não foi possível buscar as informações.' });
    } finally {
        setIsLoading(false);
    }
  }, [firestore, session, toast]);

  useEffect(() => {
    if(session) {
      fetchData();

      // Listener for vehicles
      const vehiclesCol = collection(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/vehicles`);
      const unsubscribeVehicles = onSnapshot(vehiclesCol, (snapshot) => {
          const vehicleList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FirestoreVehicle)).filter(v => v.isTruck);
          setVehicles(vehicleList);
      });

      // Listener for active runs
      const runsCol = collection(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/runs`);
      const activeRunsQuery = query(runsCol, where('status', '==', 'IN_PROGRESS'));
      const unsubscribeRuns = onSnapshot(activeRunsQuery, (snapshot) => {
          const runsMap: { [key: string]: boolean } = {};
          snapshot.forEach(doc => {
              runsMap[doc.data().vehicleId] = true;
          });
          setActiveRuns(runsMap);
      });
      
      return () => {
          unsubscribeVehicles();
          unsubscribeRuns();
      }
    }
  }, [session, firestore, fetchData]);


  const handleDelete = async (type: 'user' | 'vehicle', id: string) => {
    if (!firestore || !session) return;
    
    // TODO: Add logic to prevent deleting a user or vehicle that is in an active run.
    const collectionName = type === 'user' ? 'users' : 'vehicles';
    const docRef = doc(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/${collectionName}`, id);

    try {
      await deleteDoc(docRef);
      toast({ title: 'Sucesso', description: `${type === 'user' ? 'Usuário' : 'Veículo'} deletado com sucesso.` });
      // Data will refresh via onSnapshot listeners
    } catch (error) {
      console.error(`Error deleting ${type}:`, error);
      toast({ variant: 'destructive', title: 'Erro', description: `Não foi possível deletar o ${type}.` });
    }
  };

  if (!session) {
     return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Gerenciamento</h2>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">
            <User className="mr-2 h-4 w-4" />
            Gerenciar Usuários
          </TabsTrigger>
          <TabsTrigger value="trucks">
            <Truck className="mr-2 h-4 w-4" />
            Gerenciar Caminhões
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Usuários</CardTitle>
              <CardDescription>Edite ou remova usuários existentes.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center items-center h-40">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <UserManagement
                  users={users}
                  onDelete={handleDelete}
                  onUpdate={fetchData}
                  session={session}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="trucks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Caminhões</CardTitle>
              <CardDescription>Edite, remova ou gerencie a manutenção dos caminhões.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center items-center h-40">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <VehicleManagement
                  vehicles={vehicles}
                  activeRuns={activeRuns}
                  onDelete={handleDelete}
                  onUpdate={fetchData}
                  session={session}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminManagementPage;

    