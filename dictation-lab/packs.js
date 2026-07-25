"use strict";

const DICTATION_PACKS = Object.freeze([
  {
    id: "numbers-dates",
    title: "Numbers & Dates",
    label: "Pack 01",
    description: "Times, prices, years, quantities, and easily confused figures.",
    sentences: Object.freeze([
      "The appointment is scheduled for the twenty-third of September at nine thirty.",
      "Your reference number is 70418, followed by the letter B.",
      "The annual fee increased from 65 pounds to 82 pounds.",
      "Flight 306 departs at 8:45 from gate seventeen.",
      "The survey included 1,250 residents between eighteen and sixty-four.",
      "Please submit the form before Friday, the eleventh of October.",
      "The library closes at quarter past seven on weekdays.",
      "Room 214 is on the second floor beside the lift.",
      "The course ran from 1998 until 2003 without interruption.",
      "A deposit of 150 pounds is required by 6 June.",
      "The morning session lasts ninety minutes and begins at ten fifteen.",
      "Nearly thirty percent of applicants selected the third option.",
      "Bus 52 arrives every twelve minutes after half past six.",
      "The package weighs 2.7 kilograms and measures forty centimetres.",
      "Call extension 409 before 4:30 to confirm your place.",
      "The museum welcomed 48,600 visitors during the first quarter.",
      "Her membership expires on the thirty-first of January next year.",
      "The total comes to 19 pounds and 75 pence.",
      "Platform nine serves the 11:05 train to Westbury.",
      "Participants must attend at least seven of the nine workshops."
    ])
  },
  {
    id: "map-directions",
    title: "Map & Directions",
    label: "Pack 02",
    description: "Landmarks, prepositions, turns, and connected route language.",
    sentences: Object.freeze([
      "Turn left after the pharmacy and continue beyond the traffic lights.",
      "The reception desk is opposite the stairs near the main entrance.",
      "Walk through the courtyard and take the path beside the fountain.",
      "The laboratory is at the end of the eastern corridor.",
      "Cross the bridge, then follow the river until the path divides.",
      "The bicycle racks are behind the theatre and beside the cafe.",
      "Go past the bank and turn right into Orchard Lane.",
      "The picnic area lies between the woodland and the visitor centre.",
      "Take the second exit and continue towards the railway station.",
      "The information point is immediately inside the northern gate.",
      "You will find the toilets underneath the central staircase.",
      "Follow the signs around the lake to reach the campsite.",
      "The new car park is just beyond the sports hall.",
      "Enter through the side door facing the public gardens.",
      "The footpath runs along the fence before bending sharply west.",
      "Keep the bookshop on your right as you cross the square.",
      "The seminar room is above the cafe on the first floor.",
      "At the roundabout, take the road between the clinic and supermarket.",
      "Continue straight ahead until you reach a narrow stone arch.",
      "The ticket office has moved from beside the entrance to reception."
    ])
  },
  {
    id: "academic-lecture",
    title: "Academic Lecture",
    label: "Pack 03",
    description: "Dense ideas, weak forms, plurals, and academic word endings.",
    sentences: Object.freeze([
      "Recent studies suggest that urban trees reduce summer temperatures significantly.",
      "The researchers collected samples from three separate coastal environments.",
      "Economic growth does not always produce measurable improvements in wellbeing.",
      "These findings challenge the theory proposed in the previous lecture.",
      "Most species adapt gradually when environmental pressures remain relatively stable.",
      "The experiment was repeated to eliminate errors in the initial measurements.",
      "Social networks can influence how quickly new technologies are adopted.",
      "A reliable conclusion requires evidence from several independent sources.",
      "The earliest settlements developed near rivers with predictable seasonal floods.",
      "Students should distinguish between correlation and a direct causal relationship.",
      "The data indicate that both groups responded differently under pressure.",
      "Agricultural practices have transformed the composition of many regional soils.",
      "One limitation of the model is its dependence on historical averages.",
      "The committee recommended further research into long-term behavioural changes.",
      "Public attitudes towards conservation vary across generations and income groups.",
      "The second phase focuses on how participants interpret ambiguous visual signals.",
      "Several explanations were considered, but none accounted for every observation.",
      "Energy consumption tends to decline when households receive detailed feedback.",
      "The evidence was insufficient to support the original hypothesis fully.",
      "Cultural expectations shape both individual choices and institutional policies."
    ])
  },
  {
    id: "form-completion",
    title: "Form Completion",
    label: "Pack 04",
    description: "Names, addresses, occupations, categories, and precise details.",
    sentences: Object.freeze([
      "Please record the surname as Merton, with an O before the N.",
      "The contact address is 14 Willow Crescent, Northbridge.",
      "Her current occupation is laboratory assistant, not laboratory technician.",
      "Select the standard membership and tick the monthly payment option.",
      "The emergency contact is her brother, Daniel Reeves.",
      "Applicants should list photography as their main leisure interest.",
      "He requested a vegetarian meal without dairy products.",
      "The preferred departure point is Central Station, not the airport.",
      "Write the policy number in the box marked office use.",
      "Her postcode is NB4 7QL, with a seven in the middle.",
      "The booking includes a single room with breakfast for two nights.",
      "Please enter Greenwood as one word in the family name field.",
      "The applicant has worked in retail for eighteen months.",
      "Choose beginner level because she has no previous sailing experience.",
      "His email address uses a full stop between both names.",
      "The delivery should arrive at the rear entrance after midday.",
      "Tick the box for public transport under usual travel method.",
      "She heard about the course through a colleague at work.",
      "The medical form notes a mild allergy to peanuts.",
      "Use Mrs rather than Miss in the title section."
    ])
  }
]);

if (typeof module !== "undefined" && module.exports) {
  module.exports = DICTATION_PACKS;
}
