
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useFirebase } from '@/firebase';
import { collection, getDocs, doc, deleteDoc } from 'firebase/firestore';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, User, Truck, ArrowLeft } from 'lucide-react';
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
};

export type FirestoreVehicle = {
  id: string;
  model: string;
  isTruck: boolean;
};

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
            // Assuming email is matricula@frotacontrol.com and we want to get the matricula back
            const userDocInAuth = doc.id; // In our setup, user UID from Auth is the doc ID
            // We need to fetch matricula from somewhere else if it's not in the user doc itself.
            // For now, let's assume we can't easily get it back from the email. We'll use the UID or a placeholder.
            // A better solution would be to store matricula in the user document. Let's assume it's NOT there for now.
             return {
                id: doc.id,
                name: data.name,
                truck: data.truck,
                isAdmin: data.isAdmin,
                matricula: 'N/A' // Placeholder
            } as FirestoreUser
        });
        setUsers(userList);

        const vehiclesCol = collection(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/vehicles`);
        const vehiclesSnapshot = await getDocs(vehiclesCol);
        const vehicleList = vehiclesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FirestoreVehicle));
        setVehicles(vehicleList.filter(v => v.isTruck));
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
    }
  }, [session, fetchData]);


  const handleDelete = async (type: 'user' | 'vehicle', id: string) => {
    if (!firestore || !session) return;
    
    const collectionName = type === 'user' ? 'users' : 'vehicles';
    const docRef = doc(firestore, `companies/${session.companyId}/sectors/${session.sectorId}/${collectionName}`, id);

    try {
      await deleteDoc(docRef);
      toast({ title: 'Sucesso', description: `${type === 'user' ? 'Usuário' : 'Veículo'} deletado com sucesso.` });
      fetchData(); // Refresh data
    } catch (error) {
      console.error(`Error deleting ${type}:`, error);
      toast({ variant: 'destructive', title: 'Erro', description: `Não foi possível deletar o ${type}.` });
    }
  };

  if (!session) {
     return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="icon" onClick={() => router.push('/dashboard-admin')}>
                <ArrowLeft />
            </Button>
            <div>
                <h1 className="text-3xl font-bold">Gerenciamento</h1>
                <p className="text-muted-foreground">Gerencie os usuários e caminhões do sistema.</p>
            </div>
        </div>

        <Tabs defaultValue="users">
            <TabsList className="grid w-full grid-cols-2 max-w-md mx-auto mb-6">
                <TabsTrigger value="users"><User className="mr-2"/> Usuários</TabsTrigger>
                <TabsTrigger value="trucks"><Truck className="mr-2"/> Caminhões</TabsTrigger>
            </TabsList>
            <TabsContent value="users">
                <Card>
                    <CardHeader>
                        <CardTitle>Gerenciar Usuários</CardTitle>
                        <CardDescription>Edite ou remova usuários existentes.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex justify-center items-center h-40"><Loader2 className="h-8 w-8 animate-spin"/></div>
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
            <TabsContent value="trucks">
                <Card>
                    <CardHeader>
                        <CardTitle>Gerenciar Caminhões</CardTitle>
                        <CardDescription>Edite ou remova caminhões da frota.</CardDescription>
                    </CardHeader>
                    <CardContent>
                         {isLoading ? (
                            <div className="flex justify-center items-center h-40"><Loader2 className="h-8 w-8 animate-spin"/></div>
                        ) : (
                            <VehicleManagement
                                vehicles={vehicles}
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
