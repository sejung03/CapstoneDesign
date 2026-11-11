// Explicit provider/search categories only. This catalog does not classify symptoms.
export const departmentCatalog=[
 {
  "key": "internal",
  "keyword": "내과",
  "aliases": [
   "내과",
   "internal medicine"
  ]
 },
 {
  "key": "family",
  "keyword": "가정의학과",
  "aliases": [
   "가정의학과",
   "family medicine"
  ]
 },
 {
  "key": "pediatrics",
  "keyword": "소아청소년과",
  "aliases": [
   "소아청소년과",
   "pediatrics",
   "소아과"
  ]
 },
 {
  "key": "ent",
  "keyword": "이비인후과",
  "aliases": [
   "이비인후과",
   "ent"
  ]
 },
 {
  "key": "ophthalmology",
  "keyword": "안과",
  "aliases": [
   "안과",
   "ophthalmology"
  ]
 },
 {
  "key": "dermatology",
  "keyword": "피부과",
  "aliases": [
   "피부과",
   "dermatology"
  ]
 },
 {
  "key": "orthopedics",
  "keyword": "정형외과",
  "aliases": [
   "정형외과",
   "orthopedics"
  ]
 },
 {
  "key": "neurosurgery",
  "keyword": "신경외과",
  "aliases": [
   "신경외과",
   "neurosurgery"
  ]
 },
 {
  "key": "neurology",
  "keyword": "신경과",
  "aliases": [
   "신경과",
   "neurology"
  ]
 },
 {
  "key": "psychiatry",
  "keyword": "정신건강의학과",
  "aliases": [
   "정신건강의학과",
   "psychiatry",
   "정신과"
  ]
 },
 {
  "key": "obgyn",
  "keyword": "산부인과",
  "aliases": [
   "산부인과",
   "obstetrics and gynecology"
  ]
 },
 {
  "key": "urology",
  "keyword": "비뇨의학과",
  "aliases": [
   "비뇨의학과",
   "urology",
   "비뇨기과"
  ]
 },
 {
  "key": "surgery",
  "keyword": "외과",
  "aliases": [
   "외과",
   "surgery"
  ]
 },
 {
  "key": "thoracic",
  "keyword": "심장혈관흉부외과",
  "aliases": [
   "심장혈관흉부외과",
   "cardiothoracic surgery",
   "흉부외과"
  ]
 },
 {
  "key": "plastic",
  "keyword": "성형외과",
  "aliases": [
   "성형외과",
   "plastic surgery"
  ]
 },
 {
  "key": "pain",
  "keyword": "마취통증의학과",
  "aliases": [
   "마취통증의학과",
   "anesthesiology and pain medicine",
   "통증의학과"
  ]
 },
 {
  "key": "rehabilitation",
  "keyword": "재활의학과",
  "aliases": [
   "재활의학과",
   "rehabilitation medicine"
  ]
 },
 {
  "key": "emergency",
  "keyword": "응급의학과",
  "aliases": [
   "응급의학과",
   "emergency medicine"
  ]
 },
 {
  "key": "radiology",
  "keyword": "영상의학과",
  "aliases": [
   "영상의학과",
   "radiology"
  ]
 },
 {
  "key": "radiation",
  "keyword": "방사선종양학과",
  "aliases": [
   "방사선종양학과",
   "radiation oncology"
  ]
 },
 {
  "key": "pathology",
  "keyword": "병리과",
  "aliases": [
   "병리과",
   "pathology"
  ]
 },
 {
  "key": "laboratory",
  "keyword": "진단검사의학과",
  "aliases": [
   "진단검사의학과",
   "laboratory medicine"
  ]
 },
 {
  "key": "occupational",
  "keyword": "직업환경의학과",
  "aliases": [
   "직업환경의학과",
   "occupational medicine"
  ]
 },
 {
  "key": "nuclear",
  "keyword": "핵의학과",
  "aliases": [
   "핵의학과",
   "nuclear medicine"
  ]
 },
 {
  "key": "preventive",
  "keyword": "예방의학과",
  "aliases": [
   "예방의학과",
   "preventive medicine"
  ]
 },
 {
  "key": "tuberculosis",
  "keyword": "결핵과",
  "aliases": [
   "결핵과",
   "tuberculosis medicine"
  ]
 },
 {
  "key": "dental",
  "keyword": "치과",
  "aliases": [
   "치과",
   "dentistry",
   "dentist",
   "dental"
  ]
 },
 {
  "key": "korean",
  "keyword": "한의원",
  "aliases": [
   "한의원",
   "korean medicine",
   "한방진료"
  ]
 },
 {
  "key": "pharmacy",
  "keyword": "약국",
  "aliases": [
   "약국",
   "pharmacy"
  ]
 }
];
export const departmentByKey=Object.fromEntries(departmentCatalog.map(item=>[item.key,item]));
export function departmentFromCategory(label){
 return departmentCatalog.find(item=>item.keyword===label||item.aliases.includes(label))?.key||'other';
}
