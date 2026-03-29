import { useState, useMemo } from 'react';
import { Avatar, Modal } from '../components/UI';
import { Plus, Search, UserPlus, Mail, Phone, MapPin, Calendar, FileText, Upload, ChevronDown, ChevronUp, Filter } from 'lucide-react';

// ── Initial candidates from CSV ──
const INITIAL_CANDIDATES = [{"lastName": "Bouab", "firstName": "Imed", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "imed.bouab.1@ulaval.ca", "phone": "(438) 855-6628", "startDate": "2025-11-16", "status": "INJOIGNABLE", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "Prefontaine", "firstName": "Maude Leduc", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "maudehlp@yahoo.ca", "phone": "(581) 337-2729", "startDate": "", "status": "INJOIGNABLE", "shifts": ""}, {"lastName": "Tafraoui", "firstName": "Radia", "region": "Laval,montreal", "title": "Infirmier(ère) Clinicien(ne)", "email": "Radiatafraoui199@hotmail.com", "phone": "(514) 977-1331", "startDate": "2024-7-15", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir"}, {"lastName": "ABID", "firstName": "Nada", "region": "Chauddière-Appalaches", "title": "Infirmier(ère) Clinicien(ne)", "email": "gemimalacombe11@yahoo.com", "phone": "(581) 307-2063", "startDate": "2024-4-19", "status": "A maintenir pour les prochains besoins", "shifts": "Nuit,Soir,Jour"}, {"lastName": "Antabli", "firstName": "Léa", "region": "Laval,Laurentides (ON NE DESSERT PAS CE TERRITOIRE),Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "lea.antabli97@gmail.com", "phone": "(514) 795-6193", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "Bernier", "firstName": "Camille", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "cami.bernier@hotmail.fr", "phone": "(581) 999-8462", "startDate": "", "status": "À CONTACTER", "shifts": ""}, {"lastName": "Chamberland", "firstName": "Catherine", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "patof160@hotmail.com", "phone": "(418) 952-9801", "startDate": "", "status": "À CONTACTER", "shifts": ""}, {"lastName": "Cosatto", "firstName": "Stéphanie", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "stephcosatto@gmail.com", "phone": "(581) 580-6001", "startDate": "", "status": "", "shifts": ""}, {"lastName": "DÉGUE", "firstName": "Kokouvi", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "Tel : 450 654 4073\nCel : 514 778 4556", "phone": "casidegue@yahoo.fr", "startDate": "2026-3-31", "status": "A maintenir pour les prochains besoins", "shifts": "Soir,Jour ,Nuit"}, {"lastName": "Desrosiers", "firstName": "Annie", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "annie.desrosiers.ciussscn@ssss.gouv.qc.ca", "phone": "(418) 802-3341", "startDate": "", "status": "", "shifts": ""}, {"lastName": "Dorzema", "firstName": "Mariette", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "mariette.dorzema@gmail.com", "phone": "(514) 799-3982", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "El Akoum", "firstName": "Amthal", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "amthal23@hotmail.com", "phone": "(581) 578-0226", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir"}, {"lastName": "Fourcroy", "firstName": "Mathieu", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "mathieu.fourcroy@hotmail.com", "phone": "(581) 909-1804", "startDate": "", "status": "", "shifts": ""}, {"lastName": "IBRAHIM", "firstName": "RÉHAB", "region": "montreal,Laval", "title": "Infirmier(ère) Clinicien(ne)", "email": "saidarehab.ibrahim@gmail.com", "phone": "(514) 912-8269", "startDate": "", "status": "INJOIGNABLE", "shifts": ""}, {"lastName": "kouofo", "firstName": "albert", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "albkou@yahoo.fr", "phone": "438 930-1926 // 819 376-5525", "startDate": "2025-7-22", "status": "INJOIGNABLE", "shifts": "Jour ,Nuit,Soir"}, {"lastName": "Laaouina", "firstName": "Sofia", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "sofialaaouina25@icloud.com", "phone": "(263) 880-9579", "startDate": "2025-7-14", "status": "INJOIGNABLE", "shifts": "Nuit,Soir,Jour"}, {"lastName": "Lauriston", "firstName": "Iliana", "region": "Montérégie Ouest", "title": "Infirmier(ère) Clinicien(ne)", "email": "iliana.lauriston@gmail.com", "phone": "(514) 507-3774", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": ""}, {"lastName": "LAVALLÉE", "firstName": "STÉPHANIE", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "steph_ml88@hotmail.com", "phone": "(581) 998-6155", "startDate": "", "status": "", "shifts": ""}, {"lastName": "Marline", "firstName": "Deverze", "region": "Côte Nord", "title": "Infirmier(ère) Clinicien(ne)", "email": "marlinedeverze@yahoo.com", "phone": "(514) 839-0407", "startDate": "2026-1-1", "status": "INJOIGNABLE", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "Ngontie Njingang", "firstName": "Stéphane", "region": "Montréal", "title": "Infirmier(ère) Clinicien(ne)", "email": "ngontiestephane@yahoo.fr", "phone": "438 – 998 – 0063.", "startDate": "2025-1-9", "status": "EMPLOI TROUVÉ", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "PAGAU-COUTURE", "firstName": "MEGANE", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "MEGCOU03@ICLOUD.COM", "phone": "(418) 808-3014", "startDate": "", "status": "", "shifts": ""}, {"lastName": "Abbas", "firstName": "Tarik", "region": "Laval,Laurentides (ON NE DESSERT PAS CE TERRITOIRE)", "title": "Infirmier(ère) Clinicien(ne)", "email": "", "phone": "(438) 833-5826", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour"}, {"lastName": "Abbas", "firstName": "Eric", "region": "Montérégie Est", "title": "Infirmier(ère) Clinicien(ne)", "email": "erick_viaud@hotmail.com", "phone": "(514) 432-8178", "startDate": "2024-4-29", "status": "INJOIGNABLE", "shifts": "Jour ,Nuit"}, {"lastName": "Achraf", "firstName": "deghboudj", "region": "Montréal,Laval", "title": "Infirmier(ère) Clinicien(ne)", "email": "hassanisalah411@gmail.com", "phone": "(438) 448-3051", "startDate": "2024-7-8", "status": "INJOIGNABLE", "shifts": "Soir"}, {"lastName": "AIT TAJER", "firstName": "Abdellah", "region": "Outaouais", "title": "Infirmier(ère) Clinicien(ne)", "email": "", "phone": "(438) 543-0163", "startDate": "2025-9-1", "status": "EMPLOI TROUVÉ", "shifts": "Soir"}, {"lastName": "AlternaMedic", "firstName": "Cheryl", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "cheryl_woods2007@yahoo.ca", "phone": "(514) 690-5775", "startDate": "2024-10-28", "status": "EMPLOI TROUVÉ", "shifts": "Jour ,Soir"}, {"lastName": "Amid", "firstName": "Bilal", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "bilalzeinedine@hotmail.com", "phone": "(514) 585-2905", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": ""}, {"lastName": "Andrade", "firstName": "Juliana", "region": "Montérégie Est", "title": "Infirmier(ère) Clinicien(ne)", "email": "ju.asano@gmail.com", "phone": "(514) 502-0705", "startDate": "2024-6-1", "status": "EMPLOI TROUVÉ", "shifts": "Jour"}, {"lastName": "André", "firstName": "Adriana Raphaëll", "region": "Outaouais", "title": "Infirmier(ère) Clinicien(ne)", "email": "adriana.andre@hotmail.fr", "phone": "(514) 712-7104", "startDate": "2024-10-21", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "Ariane", "firstName": "Aubut", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "arygdesign@hotmail.com", "phone": "(514) 772-9658", "startDate": "2026-3-2", "status": "A maintenir pour les prochains besoins", "shifts": "Jour"}, {"lastName": "Aristide", "firstName": "Alexandra", "region": "Laval", "title": "Infirmier(ère) Clinicien(ne)", "email": "aaristide451@gmail.com", "phone": "5 1 4 - 9 6 7 - 7 9 6 3", "startDate": "2023-9-20", "status": "INJOIGNABLE", "shifts": "Jour"}, {"lastName": "Astrid", "firstName": "Kenge", "region": "GRAND NORD", "title": "Infirmier(ère) Clinicien(ne)", "email": "Hope.kenge@yahoo.com", "phone": "(438) 225-2165", "startDate": "2025-11-8", "status": "A maintenir pour les prochains besoins", "shifts": "Jour"}, {"lastName": "Ayotte", "firstName": "Yannie", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "yanniea@hotmail.com", "phone": "(514) 706-6770", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "B.LAFITTE", "firstName": "AUDREY //audrey.b.lafitte@gmail.com", "region": "Côte Nord", "title": "Infirmier(ère) Clinicien(ne)", "email": "", "phone": "(581) 700-8030", "startDate": "2024-6-15", "status": "PAS INTÉRESSÉ(E)", "shifts": "Soir,Nuit"}, {"lastName": "Bah", "firstName": "Gadianne", "region": "Laval,Laurentides (ON NE DESSERT PAS CE TERRITOIRE)", "title": "Infirmier(ère) Clinicien(ne)", "email": "gadianeb_1998@outlook.com>", "phone": "(439) 927-3612", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour"}, {"lastName": "Bazile", "firstName": "Megguy", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "Megguy.Bazile@hotmail.com", "phone": "(514) 248-1695", "startDate": "", "status": "EMPLOI TROUVÉ", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "Bégin", "firstName": "Amélie", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "ame_4_14@hotmail.com", "phone": "(418) 208-4900", "startDate": "", "status": "", "shifts": ""}, {"lastName": "Belhassane", "firstName": "Rim", "region": "Laval", "title": "Infirmier(ère) Clinicien(ne)", "email": "rimbelhassane@hotmail.com", "phone": "", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour"}, {"lastName": "Bernard", "firstName": "Jean Chrisnel", "region": "Trois-Rivières", "title": "Infirmier(ère) Clinicien(ne)", "email": "chrisnelbernard@gmail.com", "phone": "(438) 763-0561", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour"}, {"lastName": "Boisvert", "firstName": "Chantale", "region": "Saguenay-Lac-St-Jean", "title": "Infirmier(ère) Clinicien(ne)", "email": "Chantale.boisvert99@gmail.com", "phone": "(418) 618-9555", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "bouab 61", "firstName": "imed", "region": "Monteregie,Lanaudière", "title": "Infirmier(ère) Clinicien(ne)", "email": "bouab_quebec@yahoo.fr", "phone": "(438) 855-6628", "startDate": "2024-5-4", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "BROUSSEAU-BALBOA", "firstName": "MICHAËL", "region": "Montréal", "title": "Infirmier(ère) Clinicien(ne)", "email": "mick_tbo41@hotmail.com", "phone": "(418) 922-2461", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": "Jour"}, {"lastName": "Cabel Lezcano", "firstName": "Gloria Milagros", "region": "Lanaudière,Laval,Montérégie Est", "title": "Infirmier(ère) Clinicien(ne)", "email": "milikbl17@gmail.com", "phone": "(514) 503-7362", "startDate": "2024-4-30", "status": "INJOIGNABLE", "shifts": "Jour"}, {"lastName": "Carolane", "firstName": "Talbot", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "carolane.talbot.5@gmail.com", "phone": "(418) 580-6757", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": ""}, {"lastName": "Charnel", "firstName": "Taïnha", "region": "Lanaudière,laurentide,Laval,montreal", "title": "Infirmier(ère) Clinicien(ne)", "email": "", "phone": "(514) 616-6816", "startDate": "2024-12-2", "status": "PAS INTÉRESSÉ(E)", "shifts": "Jour ,Soir"}, {"lastName": "CHHOEUN", "firstName": "ELISABETH", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "elisabeth.chhoeun@gmail.com", "phone": "(579) 421-0158", "startDate": "2024-5-20", "status": "EMPLOI TROUVÉ", "shifts": "Jour"}, {"lastName": "chikhrouhou", "firstName": "Yassin", "region": "jordanmoussa50@gmail.com", "title": "Infirmier(ère) Clinicien(ne)", "email": "ch.yassin02@gmail.com", "phone": "'+1(418) 444 3458", "startDate": "2025-12-1", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir"}, {"lastName": "Coulibaly", "firstName": "Nabindou", "region": "Laval", "title": "Infirmier(ère) Clinicien(ne)", "email": "", "phone": "(647) 220-8065", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour"}, {"lastName": "criniti", "firstName": "nick", "region": "Montréal,Laurentides (ON NE DESSERT PAS CE TERRITOIRE)", "title": "Infirmier(ère) Clinicien(ne)", "email": "nickcriniti@hotmail.com", "phone": "(514) 690-8040", "startDate": "2024-11-16", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir"}, {"lastName": "D'haïti Pierre Louis", "firstName": "Magdala", "region": "Laval,Laurentides (ON NE DESSERT PAS CE TERRITOIRE),Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "dhaitimagdala@gmail.com", "phone": "(438) 765-1782", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "Daoud Brikci", "firstName": "nadir", "region": "Laurentides (ON NE DESSERT PAS CE TERRITOIRE)", "title": "Infirmier(ère) Clinicien(ne)", "email": "nadbrixi@hotmail.com", "phone": "(438) 928-9405", "startDate": "2023-8-7", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "Dayai", "firstName": "Hamza", "region": "GRAND NORD", "title": "Infirmier(ère) Clinicien(ne)", "email": "Dayaihamza01@gmail.com", "phone": "+ 819 550 7657 ▪ +40 770 244 872", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir"}, {"lastName": "DIALLO", "firstName": "HAWA", "region": "Outaouais,Montérégie Ouest", "title": "Infirmier(ère) Clinicien(ne)", "email": "hawadiallo887@gmail.com", "phone": "(438) 884-1726", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "DIANE", "firstName": "ROY", "region": "Régions Éloignées,GRAND NORD", "title": "Infirmier(ère) Clinicien(ne)", "email": "free325@hotmail.com", "phone": "(514) 794-2995", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": "Jour"}, {"lastName": "Diop", "firstName": "Idy Bernard", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "idybernarddiop@gmail.com", "phone": "(514) 690-8040", "startDate": "", "status": "À CONTACTER", "shifts": "Jour ,Soir"}, {"lastName": "DOS REIS SANTANA", "firstName": "DIEGO", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "diegodosreiss@hotmail.com", "phone": "(438) 491-097", "startDate": "", "status": "", "shifts": ""}, {"lastName": "Ducles", "firstName": "Whitney", "region": "Régions Éloignées,GRAND NORD", "title": "Infirmier(ère) Clinicien(ne)", "email": "duclesw@hotmail.ca", "phone": "(514) 830-3936", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": "Jour"}, {"lastName": "Dufour", "firstName": "Francine", "region": "Côte Nord,Gaspésie,Abitibi-Temiscamingue,Bas-St-Laurent", "title": "Infirmier(ère) Clinicien(ne)", "email": "francyndufour@hotmail.com", "phone": "(418) 998-9588", "startDate": "2026-3-11", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "El Gendi", "firstName": "Carolina", "region": "montreal,Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "Carolina.elgendi.rn@gmail.com", "phone": "(514) 664-0025", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "El Majhed", "firstName": "salma", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "salmaelmajhed@outlook.com", "phone": "(514) 974-7157", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "EL SAMAD", "firstName": "Abdul Fattah", "region": "Montréal,Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "sam_samad87@hotmail.com", "phone": "'+1 (514) 451-2725", "startDate": "2025-1-22", "status": "INJOIGNABLE", "shifts": ""}, {"lastName": "Elisabeth", "firstName": "Cloutier", "region": "Côte Nord,Gaspésie,Bas-St-Laurent,Outaouais", "title": "Infirmier(ère) Clinicien(ne)", "email": "ecloutier@outlook.fr", "phone": "(514) 806-9250", "startDate": "2025-11-8", "status": "A maintenir pour les prochains besoins", "shifts": "Jour"}, {"lastName": "Eric", "firstName": "joseph", "region": "Abitibi-Temiscamingue,Outaouais", "title": "Infirmier(ère) Clinicien(ne)", "email": "ejoseph67@me.com", "phone": "(438) 822-5558", "startDate": "2024-5-19", "status": "A maintenir pour les prochains besoins", "shifts": "Soir,Nuit"}, {"lastName": "Ève-Marie", "firstName": "Duguay", "region": "Laval,Centre du Québec", "title": "Infirmier(ère) Clinicien(ne)", "email": "evemariedgg@gmail.com", "phone": "(418) 264-4757", "startDate": "2024-6-10", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "Figueredo", "firstName": "David", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "", "phone": "", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": ""}, {"lastName": "FINNFLORE", "firstName": "VIELOT", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "finnflorevielot@hotmail.com", "phone": "514 -576-0593", "startDate": "2025-9-25", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "François", "firstName": "Ingrid", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "francoisingrid2000@yahoo.fr", "phone": "(514) 546-0930", "startDate": "", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "Frédéric", "firstName": "Boursin", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "boursin.frederic@gmail.com", "phone": "(438) 373-6300", "startDate": "2025-2-26", "status": "EMPLOI TROUVÉ", "shifts": "Jour"}, {"lastName": "GALLEGO", "firstName": "LAURA", "region": "Montérégie Est", "title": "Infirmier(ère) Clinicien(ne)", "email": "lalisgallego@hotmail.com", "phone": "514 746-0481", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "Gauthier", "firstName": "Annie", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "", "phone": "(450) 821-1731", "startDate": "2026-1-5", "status": "A maintenir pour les prochains besoins", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "GHELLACHE", "firstName": "MAROIE-RYANNE", "region": "Montréal", "title": "Infirmier(ère) Clinicien(ne)", "email": "Maroie.ghellache@outlook.com", "phone": "+1 5149237062", "startDate": "2025-3-9", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "Gray Lelie", "firstName": "Ineza", "region": "Montréal", "title": "Infirmier(ère) Clinicien(ne)", "email": "inezagray@gmail.com", "phone": "(514) 348-4175", "startDate": "2025-2-16", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "HADIFI", "firstName": "AFAF", "region": "Montréal", "title": "Infirmier(ère) Clinicien(ne)", "email": "ahadifi@hotmail.com", "phone": "819 967 2323", "startDate": "", "status": "SUIVI À FAIRE", "shifts": ""}, {"lastName": "HAMED", "firstName": "AHMED", "region": "Montréal,Laval", "title": "Infirmier(ère) Clinicien(ne)", "email": "", "phone": "(514) 632-6169", "startDate": "2024-5-22", "status": "PAS INTÉRESSÉ(E)", "shifts": "Jour ,Soir,Nuit"}, {"lastName": "HAMEL-LAMOUREUX", "firstName": "WILLIAM", "region": "", "title": "Infirmier(ère) Clinicien(ne)", "email": "williamhamel@hotmail.fr", "phone": "(514) 243-9419", "startDate": "2024-5-6", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "Henri", "firstName": "Claudia", "region": "Laurentides (ON NE DESSERT PAS CE TERRITOIRE)", "title": "Infirmier(ère) Clinicien(ne)", "email": "claudia_henri_114@hotmail.com", "phone": "(514) 922-6800", "startDate": "", "status": "INJOIGNABLE", "shifts": "Jour"}, {"lastName": "Houssam", "firstName": "Tissoudal", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "houssam.tissoudal@gmail.com", "phone": "(514) 834-6971", "startDate": "2026-9-1", "status": "DISPONIBLE", "shifts": "Soir,Jour ,Nuit"}, {"lastName": "husain", "firstName": "naoel", "region": "Outaouais,Côte Nord", "title": "Infirmier(ère) Clinicien(ne)", "email": "naoelhusain@hotmail.fr", "phone": "(438) 924-2597", "startDate": "2024-10-9", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "Isabelle TEST", "firstName": "Levray TEST", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "", "phone": "(514) 432-5678", "startDate": "2024-12-31", "status": "INJOIGNABLE", "shifts": "Jour ,Soir"}, {"lastName": "Jasmine", "firstName": "Zerari", "region": "Régions Éloignées", "title": "Infirmier(ère) Clinicien(ne)", "email": "jasminezerari@gmail.com", "phone": "+33768424008", "startDate": "2025-4-23", "status": "A maintenir pour les prochains besoins", "shifts": ""}];

const TITLE_OPTIONS = [
  "Infirmier(ère) Clinicien(ne)",
  "Infirmier(ère) auxiliaire",
  "Infirmier.ère",
  "Infirmière en dispensaire",
  "Préposé(e) aux bénéficiaires",
  "Éducateur(trice) spécialisé(e)",
  "Agent de relations humaines",
  "Agente administrative",
  "hygiéniste dentaire",
  "Travailleur(euse) social(e)",
];

const STATUS_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'Disponible', label: 'Disponible' },
  { value: 'En attente', label: 'En attente' },
  { value: 'Contacté', label: 'Contacté' },
  { value: 'Non disponible', label: 'Non disponible' },
];

export default function CandidatesPage({ toast }) {
  const [candidates, setCandidates] = useState(INITIAL_CANDIDATES);
  const [searchText, setSearchText] = useState('');
  const [filterTitle, setFilterTitle] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [addModal, setAddModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // ── Unique regions ──
  const regions = useMemo(() => {
    const all = candidates.flatMap(c => (c.region || '').split(',').map(r => r.trim()).filter(Boolean));
    return [...new Set(all)].sort();
  }, [candidates]);

  // ── Filtered candidates ──
  const filtered = useMemo(() => {
    let list = candidates;
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(c =>
        `${c.firstName} ${c.lastName} ${c.email} ${c.phone}`.toLowerCase().includes(q)
      );
    }
    if (filterTitle) list = list.filter(c => c.title === filterTitle);
    if (filterRegion) list = list.filter(c => (c.region || '').includes(filterRegion));
    return list;
  }, [candidates, searchText, filterTitle, filterRegion]);

  // ── Stats ──
  const titleCounts = useMemo(() => {
    const counts = {};
    candidates.forEach(c => { if (c.title) counts[c.title] = (counts[c.title] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [candidates]);

  // ── Add candidate ──
  const openAdd = () => {
    setAddModal({
      firstName: '', lastName: '', title: '', region: '',
      email: '', phone: '', startDate: '', status: 'Disponible',
      shifts: '', notes: '',
    });
  };

  const saveCandidate = () => {
    if (!addModal.firstName || !addModal.lastName) { toast?.('Nom et prénom requis'); return; }
    setCandidates(prev => [
      { ...addModal, id: Date.now() },
      ...prev,
    ]);
    setAddModal(null);
    toast?.(`Candidat(e) ${addModal.firstName} ${addModal.lastName} ajouté(e)`);
  };

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">
          <UserPlus size={22} style={{ marginRight: 8, verticalAlign: 'text-bottom', color: 'var(--brand)' }} />
          Candidats disponibles
        </h1>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <Plus size={14} /> Ajouter un candidat
        </button>
      </div>

      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 16 }}>
        <div className="stat-card" style={{ background: 'var(--brand-xl)', padding: '10px 14px' }}>
          <div className="label" style={{ color: 'var(--brand)', fontSize: 10 }}>Total candidats</div>
          <div className="value" style={{ color: 'var(--brand)', fontSize: 20 }}>{candidates.length}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--green-l)', padding: '10px 14px' }}>
          <div className="label" style={{ color: 'var(--green)', fontSize: 10 }}>Résultats filtrés</div>
          <div className="value" style={{ color: 'var(--green)', fontSize: 20 }}>{filtered.length}</div>
        </div>
        {titleCounts.slice(0, 3).map(([title, count]) => (
          <div key={title} className="stat-card" style={{ background: 'var(--purple-l)', padding: '10px 14px' }}>
            <div className="label" style={{ color: 'var(--purple)', fontSize: 10 }}>{title.slice(0, 20)}</div>
            <div className="value" style={{ color: 'var(--purple)', fontSize: 20 }}>{count}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 250px', maxWidth: 350 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }} />
          <input className="input" style={{ paddingLeft: 32, fontSize: 12 }}
            placeholder="Rechercher nom, email, téléphone..."
            value={searchText} onChange={e => setSearchText(e.target.value)} />
        </div>
        <select className="input" style={{ width: 220, fontSize: 12 }} value={filterTitle}
          onChange={e => setFilterTitle(e.target.value)}>
          <option value="">Tous les titres</option>
          {TITLE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input" style={{ width: 200, fontSize: 12 }} value={filterRegion}
          onChange={e => setFilterRegion(e.target.value)}>
          <option value="">Toutes les régions</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {(searchText || filterTitle || filterRegion) && (
          <button className="btn btn-outline btn-sm" onClick={() => { setSearchText(''); setFilterTitle(''); setFilterRegion(''); }}>
            Réinitialiser
          </button>
        )}
      </div>

      {/* Table */}
      <div className="schedule-grid">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--brand-xl)' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--brand)', textTransform: 'uppercase' }}>Candidat</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>Titre</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>Région</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>Contact</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>Disponibilité</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--brand)' }}>Début</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Aucun candidat trouvé</td></tr>
            )}
            {filtered.map((c, i) => (
              <tr key={c.id || i} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => setDetailModal(c)}>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={`${c.firstName} ${c.lastName}`} size={30} bg="var(--brand-l)" color="var(--brand)" />
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.firstName} {c.lastName}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '10px 12px', fontSize: 11 }}>{c.title || '—'}</td>
                <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text2)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.region || '—'}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {c.email && <div style={{ fontSize: 10, color: 'var(--text2)' }}>📧 {c.email}</div>}
                  {c.phone && <div style={{ fontSize: 10, color: 'var(--text2)' }}>📞 {c.phone}</div>}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  {c.shifts && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{(c.shifts || '').slice(0, 20)}</div>}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: 'var(--text2)' }}>
                  {c.startDate || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Modal */}
      {detailModal && (
        <Modal title={`${detailModal.firstName} ${detailModal.lastName}`} onClose={() => setDetailModal(null)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <Avatar name={`${detailModal.firstName} ${detailModal.lastName}`} size={50} bg="var(--brand-l)" color="var(--brand)" />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{detailModal.firstName} {detailModal.lastName}</div>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>{detailModal.title || 'Non spécifié'}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13, marginBottom: 16 }}>
            {detailModal.email && <div><span style={{ color: 'var(--text3)', fontSize: 11 }}>Email</span><div>{detailModal.email}</div></div>}
            {detailModal.phone && <div><span style={{ color: 'var(--text3)', fontSize: 11 }}>Téléphone</span><div>{detailModal.phone}</div></div>}
            {detailModal.region && <div><span style={{ color: 'var(--text3)', fontSize: 11 }}>Région(s)</span><div>{detailModal.region}</div></div>}
            {detailModal.startDate && <div><span style={{ color: 'var(--text3)', fontSize: 11 }}>Date de début</span><div>{detailModal.startDate}</div></div>}
            {detailModal.shifts && <div><span style={{ color: 'var(--text3)', fontSize: 11 }}>Quarts préférés</span><div>{detailModal.shifts}</div></div>}
            {detailModal.status && <div><span style={{ color: 'var(--text3)', fontSize: 11 }}>Statut</span><div>{detailModal.status}</div></div>}
          </div>

          {/* Upload zone for attachments */}
          <div style={{
            background: 'var(--brand-xl)', borderRadius: 'var(--r)', padding: 16,
            border: '2px dashed var(--brand-m)', textAlign: 'center', cursor: 'pointer',
          }}>
            <Upload size={18} style={{ color: 'var(--brand-m)' }} />
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>Joindre pièces (CV, permis, diplôme)</div>
          </div>

          <button className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
            onClick={() => setDetailModal(null)}>Fermer</button>
        </Modal>
      )}

      {/* Add Modal */}
      {addModal && (
        <Modal title="Ajouter un candidat" onClose={() => setAddModal(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>Prénom</label>
              <input className="input" value={addModal.firstName}
                onChange={e => setAddModal(m => ({ ...m, firstName: e.target.value }))} />
            </div>
            <div className="field"><label>Nom de famille</label>
              <input className="input" value={addModal.lastName}
                onChange={e => setAddModal(m => ({ ...m, lastName: e.target.value }))} />
            </div>
          </div>
          <div className="field"><label>Titre d'emploi</label>
            <select className="input" value={addModal.title}
              onChange={e => setAddModal(m => ({ ...m, title: e.target.value }))}>
              <option value="">— Choisir —</option>
              {TITLE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field"><label>Région(s)</label>
            <input className="input" value={addModal.region} placeholder="Ex: Régions Éloignées, Laval, Montréal"
              onChange={e => setAddModal(m => ({ ...m, region: e.target.value }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>Email</label>
              <input className="input" type="email" value={addModal.email}
                onChange={e => setAddModal(m => ({ ...m, email: e.target.value }))} />
            </div>
            <div className="field"><label>Téléphone</label>
              <input className="input" value={addModal.phone}
                onChange={e => setAddModal(m => ({ ...m, phone: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>Date de début possible</label>
              <input className="input" type="date" value={addModal.startDate}
                onChange={e => setAddModal(m => ({ ...m, startDate: e.target.value }))} />
            </div>
            <div className="field"><label>Quarts préférés</label>
              <input className="input" value={addModal.shifts} placeholder="Jour, Soir, Nuit"
                onChange={e => setAddModal(m => ({ ...m, shifts: e.target.value }))} />
            </div>
          </div>

          {/* Upload zone */}
          <div style={{
            background: 'var(--brand-xl)', borderRadius: 'var(--r)', padding: 16,
            border: '2px dashed var(--brand-m)', textAlign: 'center', cursor: 'pointer', marginBottom: 12,
          }}>
            <Upload size={18} style={{ color: 'var(--brand-m)' }} />
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>Joindre CV, diplôme, permis de conduire</div>
          </div>

          <div className="field"><label>Notes</label>
            <textarea className="input" rows={2} style={{ resize: 'vertical' }}
              value={addModal.notes || ''} onChange={e => setAddModal(m => ({ ...m, notes: e.target.value }))} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddModal(null)}>Annuler</button>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={saveCandidate}>Ajouter</button>
          </div>
        </Modal>
      )}
    </>
  );
}
