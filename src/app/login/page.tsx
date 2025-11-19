
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
import { PlaceHolderImages } from "@/lib/placeholder-images";
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
  const [isMounted, setIsMounted] = useState(false);

  const backgroundImage = PlaceHolderImages.find(img => img.id === 'login-bg');
  
  useEffect(() => {
    setIsMounted(true);
  }, [])

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
    <div className="relative h-screen w-full flex items-center justify-center overflow-hidden">
        {/* Background Image and Overlay */}
        {backgroundImage && (
            <Image
                src={backgroundImage.imageUrl}
                alt={backgroundImage.description}
                fill
                className={cn(
                    "object-cover transition-all duration-[2000ms]",
                    isMounted ? "scale-100" : "scale-125"
                )}
                priority
            />
        )}
        <div className="absolute inset-0 bg-blue-900/50" />

        {/* Login Card */}
        <div className={cn(
            "relative w-full max-w-sm rounded-xl border border-white/20 bg-white/10 p-6 shadow-2xl backdrop-blur-lg transition-all duration-700",
            isMounted ? "opacity-100 scale-100" : "opacity-0 scale-90"
        )}>
            <div className="grid gap-2 text-center text-white">
                <div className="flex items-center justify-center gap-2 mb-4">
                    <Truck className="h-8 w-8 text-white" />
                    <h1 className="text-3xl font-bold font-headline text-white">
                        Frotacontrol
                    </h1>
                </div>
                <h2 className="text-2xl font-bold font-headline">Acesse sua conta</h2>
                <p className="text-balance text-white/80">
                    Selecione sua empresa, setor e insira suas credenciais.
                </p>
            </div>
            <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 mt-6">
                <div className="grid gap-2">
                    <Controller
                        name="companyId"
                        control={control}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value} disabled={isFetchingCompanies}>
                                <SelectTrigger className="bg-white/20 border-white/30 text-white placeholder:text-white/70">
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
                    {errors.companyId && <p className="text-sm text-red-300">{errors.companyId.message}</p>}
                </div>
                <div className="grid gap-2">
                    <Controller
                        name="sectorId"
                        control={control}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value} disabled={!selectedCompanyId || isFetchingSectors}>
                                <SelectTrigger className="bg-white/20 border-white/30 text-white placeholder:text-white/70">
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
                    {errors.sectorId && <p className="text-sm text-red-300">{errors.sectorId.message}</p>}
                </div>
                <div className="grid gap-2">
                    <Controller
                        name="email"
                        control={control}
                        render={({ field }) => <Input id="email" placeholder="Sua matrícula" {...field} className="bg-white/20 border-white/30 text-white placeholder:text-white/70" />}
                    />
                    {errors.email && <p className="text-sm text-red-300">{errors.email.message}</p>}
                </div>
                <div className="grid gap-2">
                    <Controller
                        name="password"
                        control={control}
                        render={({ field }) => <Input id="password" type="password" placeholder="Sua senha" {...field} className="bg-white/20 border-white/30 text-white placeholder:text-white/70" />}
                    />
                    {errors.password && <p className="text-sm text-red-300">{errors.password.message}</p>}
                </div>
                <Button type="submit" className="w-full bg-white text-primary hover:bg-white/90" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Entrar
                </Button>
            </form>
        </div>

        <div className="fixed bottom-4 left-0 right-0 flex justify-center items-center gap-4">
            <Image src="/logo_projetos.svg" alt="Logo Projetos" width={60} height={20} className="opacity-70 invert brightness-0" />
            <Image src="/divmao.png" alt="Selo de Desenvolvimento" width={80} height={25} className="opacity-70 invert brightness-0" />
        </div>
    </div>
);

}

    