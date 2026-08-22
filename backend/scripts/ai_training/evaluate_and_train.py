import os
import pandas as pd
import numpy as np
import json
import joblib
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score, 
    balanced_accuracy_score, classification_report, confusion_matrix
)
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import LabelEncoder

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS_DIR = os.path.join(BASE_DIR, 'models_bin')
REPORTS_DIR = os.path.join(BASE_DIR, 'reports')
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)

# Disease to Specialty Mapping Dictionary for clinical continuity
DISEASE_TO_SPECIALTY = {
    "Fungal infection": "Dermatology",
    "Allergy": "Dermatology",
    "GERD": "Gastroenterology",
    "Chronic cholestasis": "Gastroenterology",
    "Drug Reaction": "Dermatology",
    "Peptic ulcer diseae": "Gastroenterology",
    "AIDS": "General Medicine",
    "Diabetes": "Endocrinology",
    "Gastroenteritis": "Gastroenterology",
    "Bronchial Asthma": "Pulmonology",
    "Hypertension": "Cardiology",
    "Migraine": "Neurology",
    "Cervical spondylosis": "Orthopedics",
    "Paralysis (brain hemorrhage)": "Neurology",
    "Jaundice": "Gastroenterology",
    "Malaria": "General Medicine",
    "Chicken pox": "Dermatology",
    "Dengue": "General Medicine",
    "Typhoid": "General Medicine",
    "hepatitis A": "Gastroenterology",
    "Hepatitis B": "Gastroenterology",
    "Hepatitis C": "Gastroenterology",
    "Hepatitis D": "Gastroenterology",
    "Hepatitis E": "Gastroenterology",
    "Alcoholic hepatitis": "Gastroenterology",
    "Tuberculosis": "Pulmonology",
    "Common Cold": "ENT",
    "Pneumonia": "Pulmonology",
    "Dimorphic hemmorhoids(piles)": "Gastroenterology",
    "Heart attack": "Cardiology",
    "Varicose veins": "Cardiology",
    "Hypothyroidism": "Endocrinology",
    "Hyperthyroidism": "Endocrinology",
    "Hypoglycemia": "Endocrinology",
    "Osteoarthristis": "Orthopedics",
    "Arthritis": "Orthopedics",
    "(vertigo) Paroymsal  Positional Vertigo": "Neurology",
    "Acne": "Dermatology",
    "Urinary tract infection": "Urology",
    "Psoriasis": "Dermatology",
    "Impetigo": "Dermatology"
}

def train_disease_prediction():
    print("Evaluating & Training Model A: Disease Prediction (Columbia Dataset)...")
    csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Columbia_Disease_Symptom_Dataset.csv")
    
    df = pd.read_csv(csv_path)
    df.columns = df.columns.str.strip()
    if 'Unnamed: 133' in df.columns:
        df = df.drop('Unnamed: 133', axis=1)

    X = df.drop('prognosis', axis=1)
    y_raw = df['prognosis']

    le = LabelEncoder()
    y = le.fit_transform(y_raw)

    # 5-Fold Stratified Cross-Validation
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = []
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    model = RandomForestClassifier(n_estimators=150, max_depth=25, min_samples_split=2, random_state=42)
    model.fit(X_train, y_train)

    cv_accs = cross_val_score(model, X, y, cv=skf, scoring='accuracy')

    y_pred = model.predict(X_test)

    acc = accuracy_score(y_test, y_pred)
    bal_acc = balanced_accuracy_score(y_test, y_pred)
    prec_macro = precision_score(y_test, y_pred, average='macro', zero_division=0)
    prec_weighted = precision_score(y_test, y_pred, average='weighted', zero_division=0)
    rec_macro = recall_score(y_test, y_pred, average='macro', zero_division=0)
    rec_weighted = recall_score(y_test, y_pred, average='weighted', zero_division=0)
    f1_macro = f1_score(y_test, y_pred, average='macro', zero_division=0)
    f1_weighted = f1_score(y_test, y_pred, average='weighted', zero_division=0)
    cm = confusion_matrix(y_test, y_pred)

    print(f"[SUCCESS] Disease Model Training Complete!")
    print(f"  Accuracy:          {acc:.4f}")
    print(f"  5-Fold CV Mean:    {cv_accs.mean():.4f} (+/- {cv_accs.std():.4f})")
    print(f"  Balanced Accuracy: {bal_acc:.4f}")
    print(f"  Macro F1-Score:    {f1_macro:.4f}")
    print(f"  Weighted F1-Score: {f1_weighted:.4f}")

    # Save artifacts to models_bin
    joblib.dump(model, os.path.join(MODELS_DIR, 'disease_model.pkl'))
    joblib.dump(le, os.path.join(MODELS_DIR, 'disease_label_encoder.pkl'))
    joblib.dump(list(X.columns), os.path.join(MODELS_DIR, 'disease_features.pkl'))
    joblib.dump(DISEASE_TO_SPECIALTY, os.path.join(MODELS_DIR, 'disease_specialty_map.pkl'))

    # Generate comprehensive report
    report_path = os.path.join(REPORTS_DIR, 'Disease_Prediction_report.txt')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write("=========================================================\n")
        f.write("MODEL A: DISEASE PREDICTION - COMPREHENSIVE EVALUATION\n")
        f.write("=========================================================\n\n")
        f.write(f"Algorithm: Random Forest Classifier (150 estimators, max_depth=25)\n")
        f.write(f"Total Samples: {len(df)} | Unique Classes: {len(le.classes_)} | Features: {X.shape[1]}\n\n")
        f.write("--- CLASS DISTRIBUTION ---\n")
        f.write(f"{df['prognosis'].value_counts().to_string()}\n\n")
        f.write(f"Accuracy:            {acc:.4f}\n")
        f.write(f"5-Fold CV Accuracy:  {cv_accs.mean():.4f} (+/- {cv_accs.std():.4f})\n")
        f.write(f"Balanced Accuracy:   {bal_acc:.4f}\n")
        f.write(f"Macro Precision:     {prec_macro:.4f}\n")
        f.write(f"Weighted Precision:  {prec_weighted:.4f}\n")
        f.write(f"Macro Recall:        {rec_macro:.4f}\n")
        f.write(f"Weighted Recall:     {rec_weighted:.4f}\n")
        f.write(f"Macro F1-Score:      {f1_macro:.4f}\n")
        f.write(f"Weighted F1-Score:   {f1_weighted:.4f}\n\n")
        f.write("--- CONFUSION MATRIX ---\n")
        f.write(f"{np.array2string(cm)}\n\n")
        f.write("--- PER-CLASS CLASSIFICATION REPORT ---\n")
        f.write(classification_report(y_test, y_pred, target_names=le.classes_, zero_division=0))

def train_referral_prediction():
    print("\nEvaluating & Training Model B: Referral Specialty Classification...")
    
    # Comprehensive clinical dataset across 15 core specialties
    raw_dataset = [
        # Pulmonology
        ("Patient presents with chronic cough, wheezing, shortness of breath, lung congestion, and asthma exacerbation.", "Pulmonology"),
        ("Reporting chest tightness, dyspnea on exertion, bronchospasm, and thick sputum production.", "Pulmonology"),
        ("Tuberculosis evaluation required, persistent hemoptysis, night sweats, and severe lung crackles.", "Pulmonology"),
        ("Severe breathless episodes at night, coughing fit, reduced oxygen levels, COPD flare up.", "Pulmonology"),
        
        # Cardiology
        ("Patient complaining of severe substernal chest pain radiating to left arm, neck, and shoulder.", "Cardiology"),
        ("High blood pressure 170/100, palpitations, giddiness, cardiac arrhythmia, and peripheral edema.", "Cardiology"),
        ("Suspected acute coronary syndrome, chest pressure, sweating, angina pectoris, and tachycardia.", "Cardiology"),
        ("Hypertensive crisis with headache, elevated BP, dyspnea, and irregular pulse.", "Cardiology"),

        # Gastroenterology
        ("Severe abdominal pain, persistent vomiting, diarrhea, acute gastric acid reflux, and hyperacidity.", "Gastroenterology"),
        ("Jaundice signs, yellow sclera, dark urine, right upper quadrant tenderness, and hepatic dysfunction.", "Gastroenterology"),
        ("Stomach ulcer symptoms, melena, epigastric burning, nausea, loss of appetite, and gastroenteritis.", "Gastroenterology"),
        ("Severe cramps in stomach, loose watery stools, dehydration, food poisoning symptoms.", "Gastroenterology"),

        # Orthopedics
        ("Severe knee joint pain, swelling, difficulty walking, osteoarthritis, and joint stiffness.", "Orthopedics"),
        ("Lower back pain, lumbar spondylosis, spine stiffness, sciatica radiating to leg, and muscle spasms.", "Orthopedics"),
        ("Fracture suspicion after fall, swollen ankle, inability to bear weight, bone pain.", "Orthopedics"),
        ("Rheumatoid joint swelling, morning stiffness in small joints, limited range of motion.", "Orthopedics"),

        # Dermatology
        ("Extensive skin rash, intense itching, fungal skin lesion, hives, erythema, and eczema.", "Dermatology"),
        ("Psoriasis plaques on elbows and knees, scaling skin, discolored patches, and impetigo blisters.", "Dermatology"),
        ("Acne vulgaris breakouts, severe facial pustules, skin peeling, and allergic dermatitis.", "Dermatology"),
        ("Itchy red sores around mouth and nose, ooze, skin discoloration, and tinea infection.", "Dermatology"),

        # ENT
        ("Ear pain, discharge from ear, hearing loss, otitis media, and ear canal swelling.", "ENT"),
        ("Nasal congestion, severe sinus pressure, frontal headache, allergic rhinitis, and sneezing.", "ENT"),
        ("Severe throat irritation, sore throat, painful swallowing, enlarged tonsils, and pharyngitis.", "ENT"),
        ("Runny nose, nasal blockage, hoarseness of voice, and throat swelling.", "ENT"),

        # Neurology
        ("Throbbing migraine headache, photophobia, nausea, aura, and severe unilateral head pain.", "Neurology"),
        ("Numbness in facial region, slurred speech, weakness on left side of body, stroke evaluation.", "Neurology"),
        ("Dizziness, spinning sensation, positional vertigo, loss of balance, and gait unsteadiness.", "Neurology"),
        ("Seizure episode, loss of consciousness, involuntary muscular tremors, and memory confusion.", "Neurology"),

        # Gynecology
        ("Pregnant female reporting lower abdominal cramps, prenatal checkup, morning sickness.", "Gynecology"),
        ("Severe menstrual pain, dysmenorrhea, irregular menstrual cycles, and pelvic discomfort.", "Gynecology"),
        ("Vaginal discharge, pelvic pain, suspected polycystic ovarian disorder, and uterine cramps.", "Gynecology"),
        ("Third trimester pregnancy evaluation, mild edema, antenatal checkup requested.", "Gynecology"),

        # General Medicine
        ("High fever 102F, body ache, severe fatigue, generalized weakness, and malaise.", "General Medicine"),
        ("Acute febrile illness, chills, shivering, body pain, headache, suspected viral fever.", "General Medicine"),
        ("Unexplained weight loss, lethargy, fatigue, mild anemia, routine physical checkup.", "General Medicine"),
        ("Mild cold, feeling unwell, body tiredness, general consultation required.", "General Medicine"),

        # Nephrology / Urology
        ("Burning micturition, dysuria, frequent urination, foul smelling urine, and kidney flank pain.", "Urology"),
        ("Hematuria, kidney stone pain, renal colic, and urinary incontinence.", "Urology"),

        # Endocrinology
        ("Polydipsia, polyuria, uncontrolled high blood sugar levels, diabetic neuropathy.", "Endocrinology"),
        ("Extreme thyroid fatigue, cold intolerance, weight gain, goiter, hypothyroidism.", "Endocrinology"),

        # Pediatrics
        ("Child presenting with high fever, persistent crying, poor feeding, and pediatric rash.", "Pediatrics"),
        ("Infant vomiting, diarrhea, failure to thrive, and pediatric vaccination consultation.", "Pediatrics"),

        # Ophthalmology
        ("Redness in eyes, blurry vision, eye pain, excessive watering, and conjunctivitis.", "Ophthalmology"),
        ("Gradual vision loss, cataracts, elevated intraocular pressure, and macular strain.", "Ophthalmology"),

        # Psychiatry
        ("Severe anxiety, panic attacks, depressive mood, insomnia, and emotional distress.", "Psychiatry"),
        ("Chronic depression, restlessness, loss of interest, and severe sleep disturbance.", "Psychiatry"),

        # Oncology
        ("Unexplained palpable lump, lymphadenopathy, severe unexplained weight loss, night sweats.", "Oncology"),
        ("Biopsy evaluation, chronic non-healing ulcer, suspicious tissue mass growth.", "Oncology")
    ] * 20  # Augment to 960 balanced training samples

    df = pd.DataFrame(raw_dataset, columns=['transcription', 'medical_specialty'])
    X_text = df['transcription']
    y_raw = df['medical_specialty']

    le = LabelEncoder()
    y = le.fit_transform(y_raw)

    vectorizer = TfidfVectorizer(stop_words='english', ngram_range=(1, 2), max_features=2500)
    X = vectorizer.fit_transform(X_text).toarray()

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    model = RandomForestClassifier(n_estimators=150, max_depth=20, random_state=42)
    model.fit(X_train, y_train)

    cv_accs = cross_val_score(model, X, y, cv=skf, scoring='accuracy')

    y_pred = model.predict(X_test)

    acc = accuracy_score(y_test, y_pred)
    bal_acc = balanced_accuracy_score(y_test, y_pred)
    prec_macro = precision_score(y_test, y_pred, average='macro', zero_division=0)
    prec_weighted = precision_score(y_test, y_pred, average='weighted', zero_division=0)
    rec_macro = recall_score(y_test, y_pred, average='macro', zero_division=0)
    rec_weighted = recall_score(y_test, y_pred, average='weighted', zero_division=0)
    f1_macro = f1_score(y_test, y_pred, average='macro', zero_division=0)
    f1_weighted = f1_score(y_test, y_pred, average='weighted', zero_division=0)

    print(f"[SUCCESS] Referral Model Training Complete!")
    print(f"  Accuracy:          {acc:.4f}")
    print(f"  5-Fold CV Mean:    {cv_accs.mean():.4f} (+/- {cv_accs.std():.4f})")
    print(f"  Balanced Accuracy: {bal_acc:.4f}")
    print(f"  Macro F1-Score:    {f1_macro:.4f}")
    print(f"  Weighted F1-Score: {f1_weighted:.4f}")

    cm = confusion_matrix(y_test, y_pred)

    joblib.dump(model, os.path.join(MODELS_DIR, 'referral_model.pkl'))
    joblib.dump(le, os.path.join(MODELS_DIR, 'referral_label_encoder.pkl'))
    joblib.dump(vectorizer, os.path.join(MODELS_DIR, 'referral_vectorizer.pkl'))

    report_path = os.path.join(REPORTS_DIR, 'Referral_Classification_report.txt')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write("=========================================================\n")
        f.write("MODEL B: REFERRAL CLASSIFICATION - COMPREHENSIVE EVALUATION\n")
        f.write("=========================================================\n\n")
        f.write(f"Algorithm: TF-IDF Vectorizer + Random Forest Classifier (150 estimators)\n")
        f.write(f"Total Samples: {len(df)} | Unique Specialties: {len(le.classes_)}\n\n")
        f.write("--- CLASS DISTRIBUTION ---\n")
        f.write(f"{df['medical_specialty'].value_counts().to_string()}\n\n")
        f.write(f"Accuracy:            {acc:.4f}\n")
        f.write(f"5-Fold CV Accuracy:  {cv_accs.mean():.4f} (+/- {cv_accs.std():.4f})\n")
        f.write(f"Balanced Accuracy:   {bal_acc:.4f}\n")
        f.write(f"Macro Precision:     {prec_macro:.4f}\n")
        f.write(f"Weighted Precision:  {prec_weighted:.4f}\n")
        f.write(f"Macro Recall:        {rec_macro:.4f}\n")
        f.write(f"Weighted Recall:     {rec_weighted:.4f}\n")
        f.write(f"Macro F1-Score:      {f1_macro:.4f}\n")
        f.write(f"Weighted F1-Score:   {f1_weighted:.4f}\n\n")
        f.write("--- CONFUSION MATRIX ---\n")
        f.write(f"{np.array2string(cm)}\n\n")
        f.write("--- PER-CLASS CLASSIFICATION REPORT ---\n")
        f.write(classification_report(y_test, y_pred, target_names=le.classes_, zero_division=0))

if __name__ == '__main__':
    train_disease_prediction()
    train_referral_prediction()
