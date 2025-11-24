
'use client';

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Truck, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useFirebase } from '@/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword } from "firebase/auth";
import { cn } from "@/lib/utils";

const loginSchema = z.object({
  companyId: z.string().min(1, "Selecione uma empresa"),
  sectorId: z.string().min(1, "Selecione um setor"),
  email: z.string().min(1, "Matrícula é obrigatória"),
  password: z.string().min(1, "Senha é obrigatória"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

type Company = { id: string; name: string };
type Sector = { id: string; name: string };

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { firestore, auth } = useFirebase();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingCompanies, setIsFetchingCompanies] = useState(true);
  const [isFetchingSectors, setIsFetchingSectors] = useState(false);
  
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      companyId: "",
      sectorId: "",
      email: "",
      password: "",
    },
  });

  const selectedCompanyId = watch("companyId");

  useEffect(() => {
    const fetchCompanies = async () => {
      if (!firestore) return;
      setIsFetchingCompanies(true);
      try {
        const companiesCol = collection(firestore, 'companies');
        const companySnapshot = await getDocs(companiesCol);
        const companyList = companySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Company));
        setCompanies(companyList);
      } catch (error) {
        console.error("Erro ao buscar empresas:", error);
        toast({
          variant: "destructive",
          title: "Erro",
          description: "Não foi possível carregar as empresas.",
        });
      } finally {
        setIsFetchingCompanies(false);
      }
    };

    fetchCompanies();
  }, [firestore, toast]);
  
  useEffect(() => {
    const fetchSectors = async () => {
      if (!firestore || !selectedCompanyId) {
        setSectors([]);
        setValue("sectorId", "");
        return;
      }
      setIsFetchingSectors(true);
      setValue("sectorId", "");
      try {
        const sectorsCol = collection(firestore, `companies/${selectedCompanyId}/sectors`);
        const sectorSnapshot = await getDocs(sectorsCol);
        const sectorList = sectorSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Sector));
        setSectors(sectorList);
      } catch (error) {
        console.error("Erro ao buscar setores:", error);
        toast({
          variant: "destructive",
          title: "Erro",
          description: "Não foi possível carregar os setores.",
        });
      } finally {
        setIsFetchingSectors(false);
      }
    };

    fetchSectors();
  }, [selectedCompanyId, firestore, setValue, toast]);


  const onSubmit = async (data: LoginFormValues) => {
    if (!auth || !firestore) return;
    setIsLoading(true);
    try {
        const email = `${data.email}@frotacontrol.com`;
        
        let password = data.password;
        if (password.length < 6) {
            password = password.padStart(6, '0');
        }

        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
      
        const userDocRef = doc(firestore, `companies/${data.companyId}/sectors/${data.sectorId}/users`, user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const userData = userDoc.data();

            localStorage.setItem('user', JSON.stringify({ ...userData, id: user.uid }));
            localStorage.setItem('companyId', data.companyId);
            localStorage.setItem('sectorId', data.sectorId);
            localStorage.setItem('matricula', data.email);

            toast({
                title: "Sucesso",
                description: "Login realizado com sucesso!",
            });

            setTimeout(() => {
                let redirectUrl = "/dashboard-truck"; 
                if (userData.isAdmin) {
                    redirectUrl = "/dashboard-admin";
                } else if (userData.truck) {
                    redirectUrl = "/dashboard-truck";
                }
                router.push(redirectUrl);
            }, 1000);

        } else {
            throw new Error("Dados do usuário não encontrados ou usuário não pertence ao setor selecionado.");
        }

    } catch (error: any) {
        console.error("Login falhou", error);
        let description = "Ocorreu um erro desconhecido.";

        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            description = "Matrícula ou senha incorretos.";
        } else if (error.message.includes("Dados do usuário não encontrados")) {
            description = "Usuário não pertence à empresa/setor selecionado.";
        } else {
            description = "Ocorreu um erro ao fazer login. Tente novamente.";
        }
        
        toast({
            variant: "destructive",
            title: "Erro no Login",
            description,
        });
    } finally {
        setIsLoading(false);
    }
  };
  
 return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-gray-50 p-4 dark:bg-zinc-950 relative overflow-hidden">
        <div className="absolute -top-12 -left-12 w-28 h-28 bg-white rounded-full flex items-center justify-center">
            <Image src="/lsl.png" alt="LSL Logo" width={40} height={20} className="mt-10 ml-10" />
        </div>
        <div className="w-full max-w-sm">
            <div className="grid gap-2 text-center mb-8">
                <div className="flex items-center justify-center gap-2">
                    <Truck className="h-8 w-8 text-primary" />
                    <h1 className="text-4xl font-bold font-headline text-primary">
                        Frotacontrol
                    </h1>
                </div>
                <p className="text-balance text-muted-foreground">
                    A sua frota, no seu controle, na sua mão
                </p>
            </div>
            <div className="rounded-lg border bg-card p-6 shadow-sm">
                <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
                    <div className="grid gap-2">
                        <Controller
                            name="companyId"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value} disabled={isFetchingCompanies}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={isFetchingCompanies ? "Carregando..." : "Selecione a empresa"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {companies.map((company) => (
                                            <SelectItem key={company.id} value={company.id}>
                                                {company.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        {errors.companyId && <p className="text-sm text-destructive">{errors.companyId.message}</p>}
                    </div>
                    <div className="grid gap-2">
                        <Controller
                            name="sectorId"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value} disabled={!selectedCompanyId || isFetchingSectors}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={isFetchingSectors ? "Carregando..." : "Selecione o setor"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {sectors.map((sector) => (
                                            <SelectItem key={sector.id} value={sector.id}>
                                                {sector.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        {errors.sectorId && <p className="text-sm text-destructive">{errors.sectorId.message}</p>}
                    </div>
                    <div className="grid gap-2">
                         <Controller
                            name="email"
                            control={control}
                            render={({ field }) => <Input id="email" placeholder="Sua matrícula" {...field} />}
                        />
                        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                    </div>
                    <div className="grid gap-2">
                        <Controller
                            name="password"
                            control={control}
                            render={({ field }) => <Input id="password" type="password" placeholder="Sua senha" {...field} />}
                        />
                        {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
                    </div>
                    <Button type="submit" className="w-full" disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Entrar
                    </Button>
                </form>
            </div>
        </div>

        <div className="absolute bottom-6 flex items-center justify-center gap-4">
            <Image src="/logo_projetos.svg" alt="Logo Projetos" width={60} height={20} className="opacity-100" />
            <Image src="/divmao.png" alt="Selo de Desenvolvimento" width={80} height={25} className="opacity-100" />
        </div>
    </div>
);

}
